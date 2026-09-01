import { randomUUID } from "node:crypto";

import type { ActorRef, DirectorDecision, DirectorDecisionType, JsonValue } from "@/core/contracts/v2";
import { getChatProvider } from "@/core/llm/model-router";
import { retrieveKnowledgeContext } from "@/core/application/knowledge/retrieval";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

import type { MissionEngine } from "./engine";
import {
  GithubApiError,
  getGithubRepoTarget,
  getPullRequestFiles,
  listPullRequests,
  mergePullRequest,
} from "./github/github-client";
import { hasPassedAllCriteria, type MissionV2 } from "./mission";
import { findMissionPullRequest } from "./qa-runtime";
import { classifyPullRequestRisk } from "./risk-classification";

/**
 * Director Runtime v0 voor Mission Engine V2.
 *
 * Dit is de eerste zelfstandige beslisser: in plaats van dat jij handmatig
 * op "Dispatch" klikt, vraagt dit een LLM om te beoordelen wat de
 * eerstvolgende stap voor een missie moet zijn, en past die beslissing toe
 * via `engine.applyDirectorDecision`.
 *
 * Bewust smal gehouden voor v0, om te voorkomen dat een missie in een staat
 * belandt die de rest van het systeem (nog) niet kan oplossen:
 * - Werkt alleen op missies met status ACTIVE (geen openstaande taak of
 *   verzoek — dat is het enige moment waarop er iets te beslissen valt).
 * - De Director mag alleen kiezen tussen DISPATCH_ROLE (de "builder"- of
 *   "qa"-rol inzetten) en, alleen als alle succescriteria al PASSED zijn,
 *   COMPLETE_MISSION. De andere besluittypes (bv. een goedkeuring of vraag
 *   aan de eigenaar vragen) zijn uitgezet omdat er nog geen scherm is om
 *   daar iets mee te doen — die zouden een missie muurvast laten lopen.
 * - Sinds de QA-rol (zie qa-runtime.ts) beoordeelt de Director de
 *   succescriteria niet meer zelf: `hasPassedAllCriteria(mission)` (uit
 *   mission.ts) bepaalt of COMPLETE_MISSION mag, en criteria worden
 *   uitsluitend nog op PASSED/FAILED gezet doordat de QA-rol dat oordeel
 *   velt (toegepast in role-runtime.ts). Dit is een bewuste, eerlijke
 *   verbetering ten opzichte van de eerdere versie, waarin de Director bij
 *   het afronden van een missie alle criteria zelf als PASSED markeerde.
 *
 * Vanaf hier gebruikt de Director ook goedgekeurde kennis uit het Second
 * Brain (dezelfde kennis die je via de Kennis-pagina keurt) als achtergrond
 * bij zijn beslissing — zie gatherRelevantKnowledge. Dit is bewust beperkt
 * tot uitsluitend goedgekeurde kennis (retrieveKnowledgeContext filtert al
 * op status "approved") en wordt nooit boven de missie zelf gesteld: de
 * succescriteria en het doel van de missie blijven leidend.
 *
 * Belangrijke invariant + gedrag (expliciet zo gewenst door de eigenaar, ná
 * de pre-merge QA-wijziging in qa-runtime.ts): een missie met status
 * COMPLETED moet altijd betekenen dat de bijbehorende pull request ook
 * daadwerkelijk gemerged is op GitHub — nooit alleen dat QA de inhoud heeft
 * goedgekeurd. Sinds QA een pull request al ver vóór het mergen mag
 * beoordelen (zodat er een oordeel is vóórdat er gemerged wordt), voert de
 * Director de merge nu ZELF uit op het moment dat alle succescriteria al
 * PASSED zijn — MAAR alleen wanneer de risicoclassificatie (zie
 * risk-classification.ts) van de bijbehorende pull request "auto-approve"
 * is: `ensureMissionPullRequestMerged` hieronder merget in dat geval de
 * meest recente pull request van de missie (een gewone merge-commit, via de
 * GitHub API — zie mergePullRequest in github-client.ts) vóórdat de LLM-
 * Director de kans krijgt om COMPLETE_MISSION te kiezen. Eén klik van de
 * eigenaar op "volgende stap" resulteert dan zowel in de merge als in het
 * voltooien van de missie.
 *
 * Is de risicoclassificatie in plaats daarvan "needs-signoff" (de pull
 * request wijzigt meerdere bestanden tegelijk, verwijdert een bestand, of
 * raakt een gedeelde/kritieke bestandslocatie), dan mergt de Director NIET
 * zelf: hij gooit een duidelijke foutmelding met de reden en de PR-link, en
 * de missie blijft ACTIEF totdat de eigenaar de wijziging zelf heeft bekeken
 * en op GitHub gemerged — pas daarna kan de Director de missie afronden.
 * Een in-app "Goedkeuring & Mergen"-knop (zodat dit ook voor needs-signoff
 * zonder naar GitHub.com te hoeven) is bewust nog niet gebouwd; dit is de
 * eerste, kleinere stap.
 *
 * Lukt een toegestane automatische merge onverwacht niet (bijvoorbeeld een
 * mergeconflict, of de pull request is inmiddels handmatig gesloten), dan
 * gooit dit ook een duidelijke foutmelding in plaats van de missie alsnog
 * als voltooid te markeren — dezelfde stijl als de andere "verwachte,
 * tijdelijke situatie"-fouten in qa-runtime.ts en builder-runtime.ts. Is de
 * pull request al (handmatig) gemerged, dan doet dit niets — geen dubbele
 * merge-poging en geen risicoclassificatie meer nodig.
 */

const ALLOWED_AUTONOMOUS_DECISIONS: DirectorDecisionType[] = [
  "DISPATCH_ROLE",
  "COMPLETE_MISSION",
];

const MAX_RELEVANT_KNOWLEDGE = 6;
const MAX_KNOWLEDGE_CONTEXT_LENGTH = 6_000;

export interface RunDirectorStepInput {
  engine: MissionEngine;
  missionId: string;
  actor?: ActorRef;
}

export interface RunDirectorStepResult {
  mission: MissionV2;
  decision: DirectorDecision;
  usedKnowledge: KnowledgeEntry[];
}

/**
 * Haalt goedgekeurde Second Brain-kennis op die relevant is voor deze missie
 * (op basis van titel, doel en succescriteria). Bewust geen embedding-
 * aanroep hier — puur tekstuele matching — om dit besluitpad simpel en
 * foutbestendig te houden; dit kan later verfijnd worden zoals bij de
 * V1-chat (zie getDirectorMemoryContext).
 */
async function gatherRelevantKnowledge(mission: MissionV2): Promise<KnowledgeEntry[]> {
  const query = [
    mission.title,
    mission.objective,
    ...mission.successCriteria.map((criterion) => criterion.description),
  ].join("\n");

  return retrieveKnowledgeContext(mission.ownerId, query, null, MAX_RELEVANT_KNOWLEDGE);
}

function buildKnowledgeContextBlock(knowledge: KnowledgeEntry[]): string {
  if (knowledge.length === 0) {
    return "Geen relevante goedgekeurde kennis gevonden in het Second Brain.";
  }

  const blocks: string[] = [];
  let used = 0;

  for (const entry of knowledge) {
    const title = entry.title?.trim() || "(zonder titel)";
    const type = entry.type ?? "fact";
    const block = `[${type}] ${title}\n${entry.content}`;

    if (used + block.length > MAX_KNOWLEDGE_CONTEXT_LENGTH) break;

    blocks.push(block);
    used += block.length;
  }

  return blocks.join("\n\n");
}

type DispatchableRole = "builder" | "qa";

interface DirectorLlmDecision {
  decisionType: DirectorDecisionType;
  reason: string;
  nextAction: string;
  successCriteria: string[];
  role: DispatchableRole;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

function buildDirectorPrompt(
  mission: MissionV2,
  allowComplete: boolean,
  knowledge: KnowledgeEntry[],
): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    "Je bent de Director binnen The Dost Matrix, een persoonlijk AI-besturingssysteem.",
    "Jij beslist per missie wat de eerstvolgende stap is.",
    "Antwoord UITSLUITEND met geldige JSON, zonder uitleg of markdown eromheen.",
  ].join(" ");

  const criteriaLines = mission.successCriteria
    .map((criterion) => {
      const note = criterion.lastEvaluationNote?.trim();
      return note
        ? `- (${criterion.status}) ${criterion.description} — toelichting vorige beoordeling: ${note}`
        : `- (${criterion.status}) ${criterion.description}`;
    })
    .join("\n");

  const assignmentLines =
    mission.assignments.length === 0
      ? "Nog geen eerdere toewijzingen."
      : mission.assignments
          .map(
            (assignment, index) =>
              `${index + 1}. rol=${assignment.roleId}, status=${assignment.status}, opdracht="${assignment.objective}"`,
          )
          .join("\n");

  const allowedTypes = allowComplete
    ? '"COMPLETE_MISSION" (VERPLICHT — zie hieronder) of "DISPATCH_ROLE"'
    : '"DISPATCH_ROLE" (COMPLETE_MISSION is nu niet toegestaan: nog niet alle succescriteria staan op PASSED)';

  const userPrompt = [
    `Missie: "${mission.title}"`,
    `Doel: ${mission.objective}`,
    "",
    "Succescriteria (COMPLETE_MISSION mag pas als deze ALLEMAAL op PASSED staan — dat bepaalt niemand anders dan de qa-rol, ook jij niet):",
    criteriaLines,
    "",
    "Eerdere toewijzingen:",
    assignmentLines,
    "",
    "Relevante goedgekeurde kennis uit het Second Brain (uitsluitend ter achtergrond — gebruik dit nooit om de succescriteria hierboven te vervangen of aan te vullen, en verzin geen kennis die hier niet expliciet staat):",
    buildKnowledgeContextBlock(knowledge),
    "",
    'Er zijn twee rollen beschikbaar om taken aan toe te wijzen:',
    '- "builder": past daadwerkelijk bestanden aan in de GitHub-repository en opent daarvoor een pull request.',
    '- "qa": beoordeelt een pull request van de builder-rol tegen de succescriteria en zet criteria op PASSED/FAILED. Zet deze rol in nadat een builder-toewijzing is afgerond en VOORDAT je COMPLETE_MISSION overweegt — zonder een qa-toewijzing worden succescriteria nooit PASSED en kun je de missie dus nooit afronden.',
    "Staat een succescriterium op FAILED met een toelichting van de vorige beoordeling hierboven? Gebruik die toelichting dan expliciet om een preciezere 'nextAction' te formuleren voor de builder-rol (bijvoorbeeld: welk bestand nog mist, wat er specifiek nog ontbreekt) — herhaal niet zomaar dezelfde algemene opdracht die al tot een FAILED oordeel leidde.",
    allowComplete
      ? "BELANGRIJK: alle succescriteria hierboven staan al op (PASSED) — dat is al door de qa-rol geverifieerd, niet door jou aangenomen. Kies dan ALTIJD COMPLETE_MISSION. Zet in dat geval NOOIT opnieuw de qa-rol in ter herbevestiging — dat is overbodig, er is niets nieuws om te verifiëren."
      : "",
    `Kies één decisionType uit: ${allowedTypes}.`,
    "",
    "Antwoord exact in dit JSON-formaat, niets anders:",
    "{",
    '  "decisionType": "DISPATCH_ROLE" | "COMPLETE_MISSION",',
    '  "reason": "korte onderbouwing van je keuze",',
    '  "role": "builder" | "qa" (alleen relevant bij DISPATCH_ROLE),',
    '  "nextAction": "concrete opdracht voor de gekozen rol (alleen relevant bij DISPATCH_ROLE)",',
    '  "successCriteria": ["welke succescriteria deze toewijzing moet aanpakken (alleen bij DISPATCH_ROLE)"]',
    "}",
  ].join("\n");

  return { systemPrompt, userPrompt };
}

async function decideNextStep(
  mission: MissionV2,
  allowComplete: boolean,
  knowledge: KnowledgeEntry[],
): Promise<DirectorLlmDecision> {
  const provider = getChatProvider();
  const { systemPrompt, userPrompt } = buildDirectorPrompt(mission, allowComplete, knowledge);

  const completion = await provider.chatCompletion(systemPrompt, [
    { role: "user", content: userPrompt },
  ]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(completion.content));
  } catch {
    throw new Error(
      "De Director gaf geen geldig besluit terug (kon het antwoord niet als JSON lezen). Probeer het opnieuw.",
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("De Director gaf een onverwacht antwoord terug.");
  }

  const candidate = parsed as Partial<DirectorLlmDecision>;

  if (!ALLOWED_AUTONOMOUS_DECISIONS.includes(candidate.decisionType as DirectorDecisionType)) {
    throw new Error(
      `De Director koos een besluittype dat nu niet is toegestaan: ${String(candidate.decisionType)}.`,
    );
  }

  const decisionType = candidate.decisionType as DirectorDecisionType;

  if (decisionType === "COMPLETE_MISSION" && !allowComplete) {
    throw new Error(
      "De Director wilde de missie afronden, maar er is nog geen afgeronde toewijzing om op te baseren.",
    );
  }

  return {
    decisionType,
    reason:
      typeof candidate.reason === "string" && candidate.reason.trim()
        ? candidate.reason.trim()
        : "Geen onderbouwing opgegeven.",
    nextAction:
      typeof candidate.nextAction === "string" && candidate.nextAction.trim()
        ? candidate.nextAction.trim()
        : mission.objective,
    successCriteria:
      Array.isArray(candidate.successCriteria) &&
      candidate.successCriteria.every((entry) => typeof entry === "string" && entry.trim())
        ? candidate.successCriteria
        : mission.successCriteria.map((criterion) => criterion.description),
    // Standaard "builder" wanneer de Director geen (geldige) rol opgeeft —
    // veiligste keuze, aangezien "qa" zonder een bijbehorende pull request
    // toch niets zou kunnen beoordelen (zie qa-runtime.ts).
    role: candidate.role === "qa" ? "qa" : "builder",
  };
}

/**
 * Zorgt ervoor dat de meest recente pull request van deze missie gemerged
 * is, uitsluitend aangeroepen wanneer alle succescriteria al PASSED zijn
 * (dus al door de qa-rol inhoudelijk goedgekeurd). Mogelijke uitkomsten:
 * geen pull request gevonden (bijvoorbeeld een missie zonder builder-
 * toewijzing) → niets te doen; de pull request is al gemerged (bijvoorbeeld
 * omdat de eigenaar hem net zelf handmatig heeft gemerged) → ook niets te
 * doen, geen dubbele poging of classificatie meer nodig; de pull request
 * staat nog open → eerst wordt het risico geclassificeerd (zie
 * risk-classification.ts) op basis van de gewijzigde bestanden. Bij
 * "auto-approve" wordt de pull request nu zelf gemerged via de GitHub API
 * (zie mergePullRequest in github-client.ts). Bij "needs-signoff" wordt NIET
 * gemerged: dit gooit een duidelijke fout met de reden en de PR-link, zodat
 * de eigenaar de wijziging eerst zelf bekijkt en handmatig mergt. Gooit ook
 * een duidelijke, aan de eigenaar te tonen fout wanneer een toegestane
 * automatische merge onverwacht mislukt (bijvoorbeeld een mergeconflict),
 * zodat `runDirectorStep` COMPLETE_MISSION nooit kiest voor een missie
 * waarvan de wijziging niet daadwerkelijk is doorgevoerd.
 */
async function ensureMissionPullRequestMerged(mission: MissionV2): Promise<void> {
  const target = getGithubRepoTarget();
  const prs = await listPullRequests(target, "all");
  const pr = findMissionPullRequest(prs, mission.missionId);

  if (!pr || pr.merged) return;

  const files = await getPullRequestFiles(target, pr.number);
  const risk = classifyPullRequestRisk(files);

  if (risk.level === "needs-signoff") {
    throw new Error(
      `Alle succescriteria van deze missie zijn al gehaald, maar pull request #${pr.number} ("${pr.title}") vereist eerst jouw eigen goedkeuring voordat de Director hem mag mergen (risicoclassificatie: needs-signoff). Reden: ${risk.reason} Bekijk de wijziging zelf op GitHub en merge hem daar wanneer je tevreden bent — laat de Director daarna opnieuw een stap zetten om de missie af te ronden: ${pr.url}`,
    );
  }

  try {
    await mergePullRequest(target, pr.number, {
      mergeMethod: "merge",
      commitTitle: `Director: ${mission.title} (#${pr.number})`.slice(0, 200),
      commitMessage: `Automatisch gemerged door de Director (risicoclassificatie: auto-approve — ${risk.reason}) nadat de qa-rol alle succescriteria van missie "${mission.title}" heeft goedgekeurd.`,
    });
  } catch (error) {
    const detail = error instanceof GithubApiError ? error.message : String(error);
    throw new Error(
      `Alle succescriteria van deze missie zijn al gehaald, en de risicoclassificatie liet automatisch mergen toe (auto-approve — ${risk.reason}), maar het mergen van pull request #${pr.number} ("${pr.title}") is mislukt: ${detail}. Bekijk en merge de pull request zelf op GitHub, en laat de Director daarna opnieuw een stap zetten om de missie af te ronden: ${pr.url}`,
    );
  }
}

/**
 * Laat de Director één beslissing nemen over een ACTIVE mission en past die
 * direct toe. Beoordeelt zelf geen succescriteria meer — dat gebeurt
 * uitsluitend door de qa-rol (zie qa-runtime.ts en role-runtime.ts) — dus
 * COMPLETE_MISSION mag pas wanneer `hasPassedAllCriteria(mission)` al waar
 * is vóórdat deze functie wordt aangeroepen, ÉN (zie
 * `ensureMissionPullRequestMerged` hierboven) de bijbehorende pull request
 * gemerged is — die merge voert de Director in dat geval hier zelf uit.
 */
export async function runDirectorStep({
  engine,
  missionId,
  actor = { type: "director", id: "director" },
}: RunDirectorStepInput): Promise<RunDirectorStepResult> {
  const mission = await engine.getMission(missionId);

  if (!mission) {
    throw new Error(`Mission ${missionId} bestaat niet.`);
  }

  if (mission.status !== "ACTIVE") {
    throw new Error(
      `De Director kan alleen een beslissing nemen wanneer de mission ACTIEF is (huidige status: ${mission.status}).`,
    );
  }

  const allowComplete = hasPassedAllCriteria(mission) && mission.activeAssignmentIds.length === 0;

  if (allowComplete) {
    await ensureMissionPullRequestMerged(mission);
  }

  const usedKnowledge = await gatherRelevantKnowledge(mission);
  const llmDecision = await decideNextStep(mission, allowComplete, usedKnowledge);
  const now = new Date().toISOString();

  // Veiligheidsnet naast de prompt-instructie hierboven: als alle
  // succescriteria al PASSED zijn (door de qa-rol geverifieerd) en er geen
  // actieve toewijzing meer loopt, is een nieuwe qa-toewijzing per definitie
  // overbodig — er is niets nieuws om te verifiëren. LLM's volgen instructies
  // niet altijd waterdicht, dus dwing dit hier af in plaats van te vertrouwen
  // op promptgehoorzaamheid alleen.
  if (allowComplete && llmDecision.decisionType === "DISPATCH_ROLE" && llmDecision.role === "qa") {
    llmDecision.decisionType = "COMPLETE_MISSION";
    llmDecision.reason = `Alle succescriteria staan al op PASSED — geen nieuwe qa-toewijzing nodig. (Oorspronkelijke overweging van de Director: "${llmDecision.reason}")`;
  }

  const decision: DirectorDecision = {
    decisionId: randomUUID(),
    missionId: mission.missionId,
    decisionType: llmDecision.decisionType,
    reason: llmDecision.reason,
    nextAction: llmDecision.nextAction,
    assignedRole: llmDecision.decisionType === "DISPATCH_ROLE" ? llmDecision.role : undefined,
    requiredCapabilities: [],
    contextRequirements: [],
    modelConstraints: {},
    approvalRequirement: "none",
    successCriteria:
      llmDecision.decisionType === "DISPATCH_ROLE"
        ? llmDecision.successCriteria
        : mission.successCriteria.map((criterion) => criterion.description),
    failureStrategy: "Bij falen opnieuw plannen (REPLANNING).",
    createdAt: now,
  };

  const updated = await engine.applyDirectorDecision({
    actor,
    correlationId: decision.decisionId,
    issuedAt: now,
    commandVersion: "1.0",
    commandId: randomUUID(),
    commandType: "ApplyDirectorDecision",
    targetId: mission.missionId,
    expectedTargetVersion: mission.version,
    payload: { decision: decision as unknown as JsonValue },
  });

  return { mission: updated, decision, usedKnowledge };
}
