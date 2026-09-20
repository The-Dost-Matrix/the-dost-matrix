import { randomUUID } from "node:crypto";

import type { ActorRef, DirectorDecision, DirectorDecisionType, JsonValue } from "@/core/contracts/v2";
import { getChatProvider } from "@/core/llm/model-router";
import { retrieveKnowledgeContext } from "@/core/application/knowledge/retrieval";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

import type { MissionEngine } from "./engine";
import {
  GithubApiError,
  getCombinedCheckStatus,
  getGithubRepoTarget,
  getPullRequestFiles,
  listPullRequests,
  mergePullRequest,
} from "./github/github-client";
import { collectCiFailureReport } from "./ci-failure-source";
import { findUnverifiedCiReason } from "./ci-policy";
import { hasPassedAllCriteria, type MissionV2 } from "./mission";
import {
  MAX_TECHNICAL_REPAIR_ATTEMPTS,
  TECHNICAL_REPAIR_KIND,
  buildTechnicalRepairExhaustedMessage,
  buildTechnicalRepairObjective,
  buildTechnicalRepairReason,
  countTechnicalRepairAttempts,
} from "./technical-repair";
import {
  MAX_SEMANTIC_REPAIR_ATTEMPTS,
  SEMANTIC_REPAIR_KIND,
  buildSemanticRepairExhaustedMessage,
  buildSemanticRepairObjective,
  buildSemanticRepairReason,
  collectFailedCriteria,
  countSemanticRepairAttempts,
} from "./semantic-repair";
import { proposeMissionKnowledge } from "./mission-knowledge";
import { findMissionPullRequest } from "./qa-runtime";
import { classifyPullRequestRiskForMission, findHardEscalationReason } from "./risk-classification";
import { reviewPullRequestForAutomatedSignoff } from "./automated-signoff";
import {
  buildAssignmentEvidenceLines,
  formatPullRequestEvidence,
  gatherPullRequestEvidence,
  type PullRequestEvidence,
} from "./director-evidence";
import {
  buildOwnerClarificationQuestion,
  collectUndeterminedCriteria,
  findLatestBuilderRebuttal,
} from "./owner-clarification";

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
 * raakt een gedeelde/kritieke bestandslocatie), dan mergt de Director sinds
 * Stap 15 niet noodzakelijk zelf mét, maar ook niet noodzakelijk NIET: eerst
 * een harde grens (findHardEscalationReason in risk-classification.ts) die
 * altijd naar de eigenaar escaleert, ongeacht wat een modelbeoordeling zou
 * zeggen (secrets/tokens, GitHub-workflows, authenticatie, Firebase-
 * configuratie, of elke bestandsverwijdering). Valt de wijziging daar niet
 * onder, dan krijgt hij een TWEEDE, onafhankelijke modelbeoordeling die de
 * daadwerkelijke diff leest (automated-signoff.ts) — keurt die oprecht goed,
 * dan mergt de Director alsnog zelf. Bij twijfel of afwijzing (inclusief een
 * onleesbaar oordeel — dezelfde "eerlijke twijfel"-discipline als QA's
 * UNDETERMINED en de Raad's ONDUIDELIJK) gooit hij een duidelijke
 * foutmelding met de reden en de PR-link, en de missie blijft ACTIEF totdat
 * de eigenaar de wijziging zelf heeft bekeken en op GitHub — of via de
 * "Goedkeuring & Mergen"-knop — gemerged.
 *
 * Vóór Stap 15 betekende needs-signoff onvoorwaardelijk "wacht op de
 * eigenaar". Elroy heeft die beoordeling expliciet overgedragen zodat een
 * missie ook onbewaakt (bijvoorbeeld 's nachts) kan doorlopen zonder op zijn
 * eigen klik te wachten — zie de roadmap-herziening van 12 september 2026.
 *
 * Sinds Stap 5 (gestructureerde foutcodes i.p.v. string-matching) is deze
 * needs-signoff-situatie niet meer alleen aan de bewoording van de
 * foutmelding te herkennen: de fout die hieronder gegooid wordt is een
 * `DirectorRuntimeError` met een machineleesbaar `code`-veld
 * (`"NEEDS_SIGNOFF"`, zie hieronder). Dit `code`-veld loopt van hier via de
 * API-route tot in de client mee, zodat de "Goedkeuring & Mergen"-knop in
 * mission-engine-v2-panel.tsx op dat code-veld kan beslissen of hij moet
 * verschijnen, in plaats van te zoeken naar de letterlijke tekst
 * "risicoclassificatie: needs-signoff" in de foutmelding — die tekst blijft
 * in de mens-leesbare `message` staan (ter toelichting), maar mag voortaan
 * vrij wijzigen zonder de knop te breken.
 *
 * Sinds classifyPullRequestRiskForMission (zie risk-classification.ts) telt
 * niet meer alléén de bestandsgebaseerde classificatie mee, maar ook het
 * riskLevel van de missie zelf (mission.riskLevel — LOW/MEDIUM/HIGH/
 * CRITICAL, gekozen bij het aanmaken van de missie): alleen bij LOW (de
 * standaardwaarde) blijft de bestandsgebaseerde uitkomst leidend, bij
 * MEDIUM/HIGH/CRITICAL is het altijd needs-signoff, ongeacht hoe klein de
 * wijziging zelf is. Hiervoor stond riskLevel al op elke missie opgeslagen,
 * maar werd het nergens gelezen.
 *
 * Lukt een toegestane automatische merge onverwacht niet (bijvoorbeeld een
 * mergeconflict, of de pull request is inmiddels handmatig gesloten), dan
 * gooit dit ook een duidelijke foutmelding in plaats van de missie alsnog
 * als voltooid te markeren — dezelfde stijl als de andere "verwachte,
 * tijdelijke situatie"-fouten in qa-runtime.ts en builder-runtime.ts. Is de
 * pull request al (handmatig) gemerged, dan doet dit niets — geen dubbele
 * merge-poging en geen risicoclassificatie meer nodig.
 *
 * Sinds een live misser (QA keurde een pull request met een falende CI-check
 * — drie verzonnen imports die niet bestonden — toch op alle succescriteria
 * goed) controleert `ensureMissionPullRequestMerged` vóór het mergen ook
 * zelf de CI-status van de pull request (zie `getCombinedCheckStatus` in
 * github-client.ts) en weigert te mergen zolang die niet geslaagd is —
 * ongeacht de risicoclassificatie. Dit is een tweede, onafhankelijke
 * verdedigingslaag: de eerste (en normaal doorslaggevende) zit al in
 * qa-runtime.ts, dat vóór een GEHAALD-oordeel dezelfde controle uitvoert.
 *
 * Sluit de Second Brain-leerlus: zodra een missie hier daadwerkelijk
 * COMPLETED wordt, stelt `proposeMissionKnowledge` (zie mission-knowledge.ts)
 * automatisch kennisitems voor op basis van wat de missie heeft opgeleverd
 * (net als de bestaande chat- en document-importvoorstellen, ter beoordeling
 * op de Kennis-pagina — nooit automatisch goedgekeurd). Dit is bewust
 * best-effort: een fout daarin kan de voltooiing van de missie zelf nooit
 * laten mislukken.
 */

const ALLOWED_AUTONOMOUS_DECISIONS: DirectorDecisionType[] = [
  "DISPATCH_ROLE",
  "COMPLETE_MISSION",
];

const MAX_RELEVANT_KNOWLEDGE = 6;
const MAX_KNOWLEDGE_CONTEXT_LENGTH = 6_000;

/**
 * Machineleesbare foutcodes die de Director-runtime kan gooien wanneer een
 * verder correct verlopen stap (alle succescriteria PASSED) toch niet mag
 * leiden tot een automatische merge/voltooiing van de missie. Dit is de
 * kern van Stap 5 ("gestructureerde foutcodes i.p.v. string-matching"): de
 * mens-leesbare `message` van `DirectorRuntimeError` mag vrijelijk van
 * bewoording veranderen, maar `code` is een stabiel contract tussen server
 * en client.
 *
 * - "NEEDS_SIGNOFF": de pull request vereist eigen goedkeuring van de
 *   eigenaar (risicoclassificatie needs-signoff) voordat er gemerged mag
 *   worden. Dit is de code waar de "Goedkeuring & Mergen"-knop in
 *   mission-engine-v2-panel.tsx op reageert.
 * - "CI_CHECKS_FAILED" / "CI_CHECKS_PENDING": de CI-status van de pull
 *   request laat (nog) geen merge toe, ongeacht risicoclassificatie.
 * - "MERGE_FAILED": een toegestane automatische of handmatig goedgekeurde
 *   merge is bij GitHub zelf mislukt (bv. mergeconflict).
 * - "PULL_REQUEST_NOT_FOUND": er is geen (nog niet gemergde) pull request
 *   voor deze missie gevonden om te mergen.
 * - "CRITERIA_NOT_PASSED": er is een merge-actie aangevraagd terwijl nog
 *   niet alle succescriteria van de missie op GEHAALD staan.
 */
export type DirectorRuntimeErrorCode =
  | "NEEDS_SIGNOFF"
  | "CI_CHECKS_FAILED"
  | "CI_CHECKS_PENDING"
  // "CI_CHECKS_UNVERIFIED": de CI is niet gefaald, maar ook niet aantoonbaar
  // geslaagd — er zijn geen controles gevonden, of de stand kon niet bij
  // GitHub worden opgehaald. Zie ci-policy.ts. Bewust een eigen code en niet
  // CI_CHECKS_FAILED: er is niets kapot, er is iets niet vastgesteld, en dat
  // vraagt om een andere reactie dan een technische herstelpoging.
  | "CI_CHECKS_UNVERIFIED"
  | "MERGE_FAILED"
  | "PULL_REQUEST_NOT_FOUND"
  | "CRITERIA_NOT_PASSED"
  | "TECHNICAL_REPAIR_EXHAUSTED"
  | "SEMANTIC_REPAIR_EXHAUSTED";

/**
 * Gestructureerde fout voor situaties binnen de Director-runtime die de
 * aanroepende laag (de API-route, en uiteindelijk de client) op basis van
 * een stabiel `code`-veld moet kunnen herkennen — in plaats van op de
 * bewoording van `message` te moeten matchen. Zie de toelichting bij
 * `DirectorRuntimeErrorCode` hierboven.
 */
export class DirectorRuntimeError extends Error {
  readonly code: DirectorRuntimeErrorCode;

  constructor(code: DirectorRuntimeErrorCode, message: string) {
    super(message);
    this.name = "DirectorRuntimeError";
    this.code = code;
  }
}

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

/**
 * Haalt het JSON-besluit uit het antwoord van de Director.
 *
 * Eerst een codeblok, want dat is wat een model het vaakst doet ondanks de
 * instructie "uitsluitend JSON". Staat er geen codeblok, dan wordt het
 * buitenste `{ ... }` genomen in plaats van de hele tekst: een model dat er
 * "Hier is mijn besluit:" voor zet leverde anders een onbruikbare fout op,
 * terwijl het besluit zelf gewoon in het antwoord stond.
 *
 * Dit is dezelfde aanpak die qa-runtime.ts al gebruikt (extractJsonObject);
 * de Director bleef achter met een strengere variant. Hier geen eigen fout
 * gooien bij het ontbreken van accolades — de aanroeper hieronder maakt er
 * één met de diagnose erbij.
 */
/** Het buitenste `{ ... }` uit een tekst, of null als dat er niet in zit. */
function outermostObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  return start !== -1 && end > start ? text.slice(start, end + 1) : null;
}

function isParsableJson(candidate: string): boolean {
  try {
    JSON.parse(candidate);
    return true;
  } catch {
    return false;
  }
}

export function extractJson(text: string): string {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const insideFence = fenced ? fenced[1].trim() : null;

  // De volgorde is het hele punt van deze functie, en is met schade en
  // schande zo gekomen.
  //
  // Een eerdere versie zocht éérst naar een codeblok en nam altijd de inhoud
  // daarvan. Dat ging fout op een besluit dat zelf over codeblokken ging: de
  // Director schreef in zijn nextAction dat de Builder moest testen of een
  // antwoord "in markdown-codehekken (```json ... ```)" nog gelezen wordt.
  // Die hekken stonden dus middenin een JSON-tekstwaarde. De functie knipte
  // daartussenuit en hield "..." over — van een antwoord dat gewoon geldige
  // JSON was.
  //
  // Vandaar: niet raden welke vorm het antwoord heeft, maar de vormen op
  // volgorde van waarschijnlijkheid proberen en de eerste nemen die
  // daadwerkelijk te lezen is. Kaal JSON wint van alles, en een codeblok
  // komt pas in beeld als het antwoord als geheel niet leesbaar is.
  const candidates = [
    trimmed,
    outermostObject(trimmed),
    insideFence,
    insideFence ? outermostObject(insideFence) : null,
  ];

  for (const candidate of candidates) {
    if (candidate && isParsableJson(candidate)) return candidate;
  }

  // Niets was leesbaar. De ruwe tekst teruggeven, zodat de aanroeper zijn
  // eigen foutmelding maakt met het volledige antwoord erbij in plaats van
  // met een half afgeknipt fragment.
  return trimmed;
}

/** Hoeveel tekens van een onleesbaar antwoord in de foutmelding komen. */
export const MAX_DIRECTOR_ERROR_EXCERPT = 300;

/**
 * De foutmelding bij een onleesbaar Director-antwoord, mét bewijs.
 *
 * De oude melding was "kon het antwoord niet als JSON lezen. Probeer het
 * opnieuw." — en gooide precies datgene weg wat nodig is om te weten wat er
 * misging. Opnieuw proberen is dan het enige wat je kunt doen, ook wanneer
 * het elke keer opnieuw zal mislukken.
 *
 * `stopReason` staat er apart bij omdat die het verschil vertelt tussen een
 * antwoord dat door het tokenplafond is afgekapt ("max_tokens" — plafond
 * omhoog) en een model dat gewoon iets anders schreef dan JSON (een
 * prompt-probleem). Zie de toelichting bij ChatCompletionResult in
 * core/llm/types.ts.
 */
export function buildDirectorParseErrorMessage(
  content: string,
  stopReason: string | undefined,
): string {
  const excerpt = content.trim().slice(0, MAX_DIRECTOR_ERROR_EXCERPT);
  const truncated = content.trim().length > MAX_DIRECTOR_ERROR_EXCERPT ? "…" : "";

  return [
    "De Director gaf geen geldig besluit terug (kon het antwoord niet als JSON lezen).",
    `Reden van stoppen volgens het model: ${stopReason ?? "onbekend"}.`,
    `Antwoordlengte: ${content.trim().length} tekens.`,
    `Begin van het antwoord: ${excerpt || "(leeg)"}${truncated}`,
  ].join(" ");
}

function buildDirectorPrompt(
  mission: MissionV2,
  allowComplete: boolean,
  knowledge: KnowledgeEntry[],
  pullRequestEvidence: PullRequestEvidence | null,
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

  // Stap 17: deze regels bevatten sinds die stap ook wat elke toewijzing
  // daadwerkelijk heeft OPGELEVERD (resultSummary) en of het om een
  // herstelpoging ging (kind) — zie director-evidence.ts voor waarom, en voor
  // de begrenzing die voorkomt dat een vastgelopen herstellus de prompt laat
  // meegroeien.
  const assignmentLines = buildAssignmentEvidenceLines(mission.assignments);

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
    "Eerdere toewijzingen (met wat ze hebben opgeleverd):",
    assignmentLines,
    "",
    "Huidige stand van de pull request van deze missie:",
    formatPullRequestEvidence(pullRequestEvidence),
    "",
    "Relevante goedgekeurde kennis uit het Second Brain (uitsluitend ter achtergrond — gebruik dit nooit om de succescriteria hierboven te vervangen of aan te vullen, en verzin geen kennis die hier niet expliciet staat):",
    buildKnowledgeContextBlock(knowledge),
    "",
    'Er zijn twee rollen beschikbaar om taken aan toe te wijzen:',
    '- "builder": past daadwerkelijk bestanden aan in de GitHub-repository en opent daarvoor een pull request.',
    '- "qa": beoordeelt een pull request van de builder-rol tegen de succescriteria en zet criteria op PASSED/FAILED. Zet deze rol in nadat een builder-toewijzing is afgerond en VOORDAT je COMPLETE_MISSION overweegt — zonder een qa-toewijzing worden succescriteria nooit PASSED en kun je de missie dus nooit afronden.',
    "Staat een succescriterium op FAILED met een toelichting van de vorige beoordeling hierboven? Gebruik die toelichting dan expliciet om een preciezere 'nextAction' te formuleren voor de builder-rol (bijvoorbeeld: welk bestand nog mist, wat er specifiek nog ontbreekt) — herhaal niet zomaar dezelfde algemene opdracht die al tot een FAILED oordeel leidde.",
    "Gebruik het resultaat van eerdere toewijzingen en de stand van de pull request hierboven als feitelijke uitgangspositie, niet als achtergrond. Concreet: staat de CI op GEFAALD, dan is een nieuwe qa-toewijzing zinloos — laat de builder eerst de falende check oplossen en noem die check bij naam in je 'nextAction'. Loopt de CI nog, kies dan niets dat op een groene CI rekent. Zie je aan de resultaten dat er al een of meer herstelpogingen (soort=TECHNICAL_REPAIR of SEMANTIC_REPAIR) zijn geweest, formuleer dan een opdracht die aantoonbaar verschilt van wat er al is geprobeerd; hetzelfde nog een keer vragen levert hetzelfde resultaat op. Raakt de pull request bestanden die niets met de succescriteria te maken hebben, benoem dat dan in je 'reason'.",
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
  pullRequestEvidence: PullRequestEvidence | null,
): Promise<DirectorLlmDecision> {
  const provider = getChatProvider();
  const { systemPrompt, userPrompt } = buildDirectorPrompt(
    mission,
    allowComplete,
    knowledge,
    pullRequestEvidence,
  );

  const completion = await provider.chatCompletion(systemPrompt, [
    { role: "user", content: userPrompt },
  ]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(completion.content));
  } catch (parseError) {
    // Het volledige antwoord in het serverlogboek, niet alleen in de
    // foutmelding: die staat in een smalle rode balk in de UI en kan
    // onmogelijk drieduizend tekens tonen, terwijl de fout juist in het
    // stuk zit dat daar niet meer in past. Zonder dit is de enige manier om
    // te weten wat het model schreef: raden.
    //
    // Ook het stuk dat na extractJson() overbleef, want een verschil tussen
    // die twee wijst het probleem meteen aan (tekst eromheen, een codeblok,
    // of een tweede object).
    console.error("Director-besluit kon niet als JSON gelezen worden", {
      missionId: mission.missionId,
      model: completion.model,
      stopReason: completion.stopReason,
      parseError: parseError instanceof Error ? parseError.message : parseError,
      ruwAntwoord: completion.content,
      naExtractie: extractJson(completion.content),
    });

    throw new Error(
      buildDirectorParseErrorMessage(completion.content, completion.stopReason),
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
 * gemerged: dit gooit een `DirectorRuntimeError` met `code: "NEEDS_SIGNOFF"`
 * (plus een mens-leesbare reden en de PR-link in `message`), zodat de
 * eigenaar de wijziging eerst zelf bekijkt en handmatig mergt — of de
 * "Goedkeuring & Mergen"-knop gebruikt, die op ditzelfde `code`-veld
 * reageert in plaats van op de tekst van `message`. Gooit ook een
 * duidelijke, aan de eigenaar te tonen fout wanneer een toegestane
 * automatische merge onverwacht mislukt (bijvoorbeeld een mergeconflict),
 * zodat `runDirectorStep` COMPLETE_MISSION nooit kiest voor een missie
 * waarvan de wijziging niet daadwerkelijk is doorgevoerd.
 *
 * Geëxporteerd (i.p.v. module-privé) zodat dit needs-signoff-pad in
 * director-runtime.test.ts rechtstreeks en met een correcte MissionV2-
 * invoer getest kan worden, in plaats van via een verzonnen los
 * `{pullRequest, riskClassification}`-object dat nooit bij de echte
 * functiesignatuur paste.
 */
/**
 * Wat de Director moet doen voordat er iets te overwegen valt, of `null`
 * wanneer er niets te herstellen is.
 */
export interface MissionRepairPlan {
  kind: "TECHNICAL_REPAIR" | "SEMANTIC_REPAIR";
  objective: string;
  reason: string;
  attempt: number;
}

/**
 * Stap 12b: in plaats van een herstelpoging (die de Builder opnieuw aan het
 * werk zet), vraagt de Director de eigenaar om een oordeel over precies één
 * succescriterium. Zie owner-clarification.ts voor de twee situaties waarin
 * dit ontstaat.
 */
export interface OwnerClarificationPlan {
  kind: "OWNER_CLARIFICATION";
  relatedCriterionId: string;
  relatedCriterionDescription: string;
  question: string;
}

export type MissionInterventionPlan = MissionRepairPlan | OwnerClarificationPlan;

/**
 * Kijkt of er een herstelpoging nodig is, en zo ja: welke soort en met welke
 * opdracht.
 *
 * Twee soorten, in deze volgorde:
 *
 * 1. TECHNISCH — de CI faalt. Er valt dan niets te wegen: de code compileert
 *    niet, dus elk ander besluit (QA laten oordelen, mergen, afronden) is
 *    zinloos. Roadmapstap 11.
 * 2. INHOUDELIJK — de CI is groen, maar QA heeft een succescriterium
 *    afgekeurd. Roadmapstap 12.
 *
 * Beide zijn vaste regels en géén beslissing van het taalmodel, om
 * verschillende redenen. Bij de technische: of code compileert is objectief
 * vast te stellen, en een LLM heeft eerder bewezen zo'n falende controle niet
 * als blokkerend te herkennen (zie `getCombinedCheckStatus` in
 * github-client.ts). Bij de inhoudelijke: de Director stuurde de Builder
 * eindeloos terug zolang QA bleef afkeuren — bij regressietest D drie keer
 * achter elkaar, zonder plafond, tot de eigenaar ingreep. Een lus zonder
 * teller hoort niet aan een oordeel te hangen.
 *
 * Beide gebruiken dezelfde opgehaalde pull request en CI-status, zodat er per
 * Director-stap niet twee keer hetzelfde bij GitHub wordt opgevraagd.
 *
 * Wordt alleen aangeroepen wanneer er geen toewijzing meer loopt — anders is
 * de stand van dit moment nog geen oordeel over werk dat nog bezig is.
 *
 * Gooit TECHNICAL_REPAIR_EXHAUSTED wanneer het technische plafond is bereikt
 * (liever expliciet stoppen dan eindeloos blijven proberen — er is bij een
 * blijvend rode CI niets dat de eigenaar met een simpel "gehaald/niet
 * gehaald" kan beslissen).
 *
 * Sinds stap 12b eindigt dit NIET meer altijd in een reparatie of een harde
 * fout zodra de CI groen is: kon QA een criterium niet vaststellen
 * ("UNDETERMINED", zie mission.ts), of is het inhoudelijke herstelplafond
 * (MAX_SEMANTIC_REPAIR_ATTEMPTS) bereikt, dan geeft dit een
 * OwnerClarificationPlan terug in plaats van een MissionRepairPlan of een
 * SEMANTIC_REPAIR_EXHAUSTED-fout — zie owner-clarification.ts.
 */
export async function planMissionRepair(
  mission: MissionV2,
): Promise<MissionInterventionPlan | null> {
  const target = getGithubRepoTarget();
  const prs = await listPullRequests(target, "all");
  const pr = findMissionPullRequest(prs, mission.missionId);

  if (!pr || pr.merged) return null;

  const ciStatus = await getCombinedCheckStatus(target, pr.headSha);

  // Nog bezig: niets doen. Een oordeel op een halve CI-uitslag is geen
  // oordeel — dezelfde regel die QA sinds stap 7 al hanteert.
  if (ciStatus.state === "pending") return null;

  if (ciStatus.state === "failure") {
    const alreadyAttempted = countTechnicalRepairAttempts(mission);

    if (alreadyAttempted >= MAX_TECHNICAL_REPAIR_ATTEMPTS) {
      throw new DirectorRuntimeError(
        "TECHNICAL_REPAIR_EXHAUSTED",
        buildTechnicalRepairExhaustedMessage(
          MAX_TECHNICAL_REPAIR_ATTEMPTS,
          pr.number,
          pr.url,
          ciStatus.failingCheckNames,
        ),
      );
    }

    const attempt = alreadyAttempted + 1;

    const failureReport =
      (await collectCiFailureReport(target, pr.headSha)) ??
      `De CI-controle(s) ${ciStatus.failingCheckNames.join(", ")} zijn mislukt, maar GitHub gaf geen nadere details terug.`;

    const changedFiles = await getPullRequestFiles(target, pr.number);

    return {
      kind: TECHNICAL_REPAIR_KIND,
      attempt,
      objective: buildTechnicalRepairObjective({
        attempt,
        maxAttempts: MAX_TECHNICAL_REPAIR_ATTEMPTS,
        pullRequestNumber: pr.number,
        changedFilePaths: changedFiles.map((file) => file.filename),
        failureReport,
      }),
      reason: buildTechnicalRepairReason({
        attempt,
        maxAttempts: MAX_TECHNICAL_REPAIR_ATTEMPTS,
        pullRequestNumber: pr.number,
        failingCheckNames: ciStatus.failingCheckNames,
      }),
    };
  }

  // Vanaf hier is de CI groen of afwezig.

  // Stap 12b, situatie 1: QA kon een of meer criteria niet vaststellen. Dit
  // is geen inhoudelijk bezwaar (er is niets om te herstellen) en dus geen
  // taak voor de Builder — de Director vraagt het meteen aan de eigenaar,
  // zonder eerst een herstelpoging te proberen die niets zou kunnen oplossen.
  const undetermined = collectUndeterminedCriteria(mission);

  if (undetermined.length > 0) {
    const primary = undetermined[0];

    return {
      kind: "OWNER_CLARIFICATION",
      relatedCriterionId: primary.criterionId,
      relatedCriterionDescription: primary.description,
      question: buildOwnerClarificationQuestion({
        intro: `QA kon niet vaststellen of het succescriterium "${primary.description}" is gehaald.`,
        criteria: undetermined,
        builderRebuttal: findLatestBuilderRebuttal(mission),
      }),
    };
  }

  // Blijft alleen een inhoudelijk bezwaar van QA over.
  const failedCriteria = collectFailedCriteria(mission);

  if (failedCriteria.length === 0) return null;

  const alreadyAttempted = countSemanticRepairAttempts(mission);

  if (alreadyAttempted >= MAX_SEMANTIC_REPAIR_ATTEMPTS) {
    // Stap 12b, situatie 2: i.p.v. hier te stoppen (voorheen
    // SEMANTIC_REPAIR_EXHAUSTED), vraagt de Director het nu aan de eigenaar
    // — met dezelfde uitputtingsmelding als introductie, zodat die tekst
    // niet dubbel wordt onderhouden.
    const primary = failedCriteria[0];

    return {
      kind: "OWNER_CLARIFICATION",
      relatedCriterionId: primary.criterionId,
      relatedCriterionDescription: primary.description,
      question: buildOwnerClarificationQuestion({
        intro: buildSemanticRepairExhaustedMessage(
          MAX_SEMANTIC_REPAIR_ATTEMPTS,
          pr.number,
          pr.url,
          failedCriteria,
        ),
        criteria: failedCriteria.map((criterion) => ({
          criterionId: criterion.criterionId,
          description: criterion.description,
          qaDoubt: criterion.note,
        })),
        builderRebuttal: findLatestBuilderRebuttal(mission),
      }),
    };
  }

  const attempt = alreadyAttempted + 1;
  const changedFiles = await getPullRequestFiles(target, pr.number);

  return {
    kind: SEMANTIC_REPAIR_KIND,
    attempt,
    objective: buildSemanticRepairObjective({
      attempt,
      maxAttempts: MAX_SEMANTIC_REPAIR_ATTEMPTS,
      pullRequestNumber: pr.number,
      changedFilePaths: changedFiles.map((file) => file.filename),
      failedCriteria,
    }),
    reason: buildSemanticRepairReason({
      attempt,
      maxAttempts: MAX_SEMANTIC_REPAIR_ATTEMPTS,
      pullRequestNumber: pr.number,
      failedCriteriaCount: failedCriteria.length,
    }),
  };
}

export async function ensureMissionPullRequestMerged(mission: MissionV2): Promise<void> {
  const target = getGithubRepoTarget();
  const prs = await listPullRequests(target, "all");
  const pr = findMissionPullRequest(prs, mission.missionId);

  if (!pr || pr.merged) return;

  // Tweede, onafhankelijke verdedigingslaag naast de CI-controle die
  // qa-runtime.ts al vóór het GEHAALD-oordeel uitvoert: die controle
  // voorkomt normaal al dat een PR met falende CI hier ooit met
  // "alle succescriteria PASSED" aankomt. Maar mocht dat toch gebeuren
  // (bijvoorbeeld: QA keurde de PR goed vóórdat een latere push de CI liet
  // falen, of een oudere QA-toewijzing werd hergebruikt), dan weigert de
  // Director hier zelf óók te mergen — ongeacht de risicoclassificatie
  // hieronder. Zonder deze controle zou een "auto-approve" PR (één bestand,
  // geen kritiek pad) met stuk-gaande CI alsnog automatisch gemerged kunnen
  // worden, puur omdat mergePullRequest zelf nooit CI-status raadpleegt.
  const ciStatus = await getCombinedCheckStatus(target, pr.headSha);

  if (ciStatus.state === "failure") {
    // Roadmapstap 11: de echte foutmelding erbij, niet alleen de naam van de
    // gefaalde controle. Zie ci-failure-source.ts.
    const failureReport = await collectCiFailureReport(target, pr.headSha);

    throw new DirectorRuntimeError(
      "CI_CHECKS_FAILED",
      `Alle succescriteria van deze missie zijn al gehaald, maar de CI-check(s) op pull request #${pr.number} ("${pr.title}") zijn mislukt (${ciStatus.failingCheckNames.join(", ")}) — de Director mergt daarom NIET, ongeacht de risicoclassificatie. Los de CI-fout eerst op via een nieuwe builder-toewijzing en laat QA opnieuw oordelen voordat je het opnieuw probeert: ${pr.url}${
        failureReport ? `\n\n${failureReport}` : ""
      }`,
    );
  }

  if (ciStatus.state === "pending") {
    throw new DirectorRuntimeError(
      "CI_CHECKS_PENDING",
      `Alle succescriteria van deze missie zijn al gehaald, maar de CI-check(s) op pull request #${pr.number} ("${pr.title}") zijn nog niet klaar (${ciStatus.pendingCheckNames.join(", ")}) — de Director wacht met mergen totdat ze zijn afgerond. Probeer het over een paar minuten opnieuw: ${pr.url}`,
    );
  }

  // F-02 (externe review, 20 september 2026): "geen controles gevonden" en
  // "kon de stand niet ophalen" zijn geen groen licht. Zie ci-policy.ts voor
  // de afweging en voor de uitzondering per project.
  const unverifiedCi = findUnverifiedCiReason(ciStatus, {
    pullRequestNumber: pr.number,
    pullRequestTitle: pr.title,
    pullRequestUrl: pr.url,
  });

  if (unverifiedCi) {
    throw new DirectorRuntimeError("CI_CHECKS_UNVERIFIED", unverifiedCi);
  }

  const files = await getPullRequestFiles(target, pr.number);
  const risk = classifyPullRequestRiskForMission(files, mission.riskLevel);

  // Stap 15: needs-signoff betekent niet meer automatisch "wacht op Elroy".
  // Eerst de harde grens (nooit geautomatiseerd, ongeacht wat een
  // modelbeoordeling zou zeggen — zie findHardEscalationReason). Pas
  // daarna, voor alles wat needs-signoff is zonder hard te escaleren, een
  // tweede, onafhankelijke modelbeoordeling die de daadwerkelijke diff leest
  // (automated-signoff.ts). Bij twijfel of afwijzing: exact hetzelfde
  // NEEDS_SIGNOFF-pad als vóór deze stap, inclusief de "Goedkeuring &
  // Mergen"-knop — er is dus geen nieuw foutpad nodig, alleen een nieuwe weg
  // ERNAARTOE.
  let commitMessage: string;

  if (risk.level === "needs-signoff") {
    const hardEscalationReason = findHardEscalationReason(files);

    if (hardEscalationReason) {
      throw new DirectorRuntimeError(
        "NEEDS_SIGNOFF",
        `Alle succescriteria van deze missie zijn al gehaald, maar pull request #${pr.number} ("${pr.title}") vereist eerst jouw eigen goedkeuring voordat er gemerged wordt — dit soort wijziging escaleert altijd, ook met geautomatiseerde signoff aan. Reden: ${hardEscalationReason} Bekijk de wijziging zelf op GitHub en merge hem daar wanneer je tevreden bent — laat de Director daarna opnieuw een stap zetten om de missie af te ronden: ${pr.url}`,
      );
    }

    const signoff = await reviewPullRequestForAutomatedSignoff(mission, files);

    if (!signoff.approved) {
      throw new DirectorRuntimeError(
        "NEEDS_SIGNOFF",
        `Alle succescriteria van deze missie zijn al gehaald, maar pull request #${pr.number} ("${pr.title}") vereist eerst jouw eigen goedkeuring voordat de Director hem mag mergen (risicoclassificatie: needs-signoff — ${risk.reason}). De geautomatiseerde beoordeling durfde dit niet zelfstandig goed te keuren: ${signoff.reason} Bekijk de wijziging zelf op GitHub en merge hem daar wanneer je tevreden bent — laat de Director daarna opnieuw een stap zetten om de missie af te ronden: ${pr.url}`,
      );
    }

    commitMessage = `Automatisch gemerged door de Director na geautomatiseerde signoff-beoordeling (risicoclassificatie: needs-signoff — ${risk.reason}) nadat de qa-rol alle succescriteria van missie "${mission.title}" heeft goedgekeurd. Beoordeling: ${signoff.reason}`;
  } else {
    commitMessage = `Automatisch gemerged door de Director (risicoclassificatie: auto-approve — ${risk.reason}) nadat de qa-rol alle succescriteria van missie "${mission.title}" heeft goedgekeurd.`;
  }

  try {
    await mergePullRequest(target, pr.number, {
      mergeMethod: "merge",
      commitTitle: `Director: ${mission.title} (#${pr.number})`.slice(0, 200),
      commitMessage,
    });
  } catch (error) {
    const detail = error instanceof GithubApiError ? error.message : String(error);
    throw new DirectorRuntimeError(
      "MERGE_FAILED",
      `Alle succescriteria van deze missie zijn al gehaald, en de wijziging is goedgekeurd om automatisch te mergen (${risk.level === "auto-approve" ? `auto-approve — ${risk.reason}` : "needs-signoff, na geautomatiseerde signoff-beoordeling"}), maar het mergen van pull request #${pr.number} ("${pr.title}") is mislukt: ${detail}. Bekijk en merge de pull request zelf op GitHub, en laat de Director daarna opnieuw een stap zetten om de missie af te ronden: ${pr.url}`,
    );
  }
}

export interface ApproveAndMergeResult {
  pullRequestNumber: number;
  pullRequestUrl: string;
}

/**
 * Roadmap-stap 4: de in-app "Goedkeuring & Mergen"-knop (zie
 * mission-engine-v2-panel.tsx), zodat de eigenaar een needs-signoff pull
 * request niet meer op GitHub.com zelf hoeft te mergen — dezelfde actie,
 * alleen uitgevoerd vanuit de app.
 *
 * Dit is BEWUST een aparte functie van `ensureMissionPullRequestMerged`
 * hierboven, en roept expliciet GEEN classifyPullRequestRiskForMission aan:
 * een klik op deze knop IS de eigen goedkeuring die needs-signoff vraagt —
 * er valt dus niets meer te classificeren, alleen nog uit te voeren. Dit is
 * geen manier om de risicocontrole te omzeilen: de eigenaar bekijkt de pull
 * request nog steeds zelf voordat hij op deze knop klikt (de knop verschijnt
 * pas ná een needs-signoff-foutmelding, met de PR-link erbij — sinds Stap 5
 * herkend via `DirectorRuntimeError.code === "NEEDS_SIGNOFF"`, niet meer via
 * tekstmatching), alleen niet meer op GitHub.com — hij mergt hem vanuit de
 * app.
 *
 * Twee vangnetten blijven wél gelden, exact zoals bij een automatische
 * auto-approve-merge hierboven:
 * - hasPassedAllCriteria(mission) is verplicht: deze knop mag nooit een pull
 *   request mergen waarvan QA de succescriteria nog niet (opnieuw) heeft
 *   goedgekeurd (bijvoorbeeld na een eerdere FAILED-beoordeling die nog niet
 *   is opgelost) — ook een expliciete klik van de eigenaar is geen vervanging
 *   voor een inhoudelijk QA-oordeel.
 * - de CI-status-controle: ook een expliciete goedkeuring van de eigenaar
 *   mag nooit een pull request mergen waarvan de CI-checks mislukken of nog
 *   lopen (zie de toelichting bij ensureMissionPullRequestMerged hierboven).
 *
 * Is de pull request inmiddels al gemergd (bijvoorbeeld doordat de eigenaar
 * ondertussen toch zelf op GitHub heeft gemerged), dan doet dit niets en
 * geeft gewoon het bestaande resultaat terug — geen dubbele merge-poging.
 */
export async function approveAndMergeMissionPullRequest(
  mission: MissionV2,
): Promise<ApproveAndMergeResult> {
  if (!hasPassedAllCriteria(mission)) {
    throw new DirectorRuntimeError(
      "CRITERIA_NOT_PASSED",
      "Nog niet alle succescriteria van deze missie staan op GEHAALD — de qa-rol moet eerst (opnieuw) akkoord geven voordat er iets gemergd kan worden.",
    );
  }

  const target = getGithubRepoTarget();
  const prs = await listPullRequests(target, "all");
  const pr = findMissionPullRequest(prs, mission.missionId);

  if (!pr) {
    throw new DirectorRuntimeError(
      "PULL_REQUEST_NOT_FOUND",
      "Geen pull request gevonden die bij deze missie hoort — er valt dus niets te mergen.",
    );
  }

  if (pr.merged) {
    return { pullRequestNumber: pr.number, pullRequestUrl: pr.url };
  }

  const ciStatus = await getCombinedCheckStatus(target, pr.headSha);

  if (ciStatus.state === "failure") {
    throw new DirectorRuntimeError(
      "CI_CHECKS_FAILED",
      `De CI-check(s) op pull request #${pr.number} ("${pr.title}") zijn mislukt (${ciStatus.failingCheckNames.join(", ")}) — ook via deze knop wordt daarom niet gemerged. Los de CI-fout eerst op via een nieuwe builder-toewijzing en laat QA opnieuw oordelen: ${pr.url}`,
    );
  }

  if (ciStatus.state === "pending") {
    throw new DirectorRuntimeError(
      "CI_CHECKS_PENDING",
      `De CI-check(s) op pull request #${pr.number} ("${pr.title}") zijn nog niet klaar (${ciStatus.pendingCheckNames.join(", ")}) — probeer het over een paar minuten opnieuw: ${pr.url}`,
    );
  }

  // F-02 (externe review, 20 september 2026): "geen controles gevonden" en
  // "kon de stand niet ophalen" zijn geen groen licht. Zie ci-policy.ts voor
  // de afweging en voor de uitzondering per project.
  const unverifiedCi = findUnverifiedCiReason(ciStatus, {
    pullRequestNumber: pr.number,
    pullRequestTitle: pr.title,
    pullRequestUrl: pr.url,
  });

  if (unverifiedCi) {
    throw new DirectorRuntimeError("CI_CHECKS_UNVERIFIED", unverifiedCi);
  }

  try {
    await mergePullRequest(target, pr.number, {
      mergeMethod: "merge",
      commitTitle: `Director: ${mission.title} (#${pr.number})`.slice(0, 200),
      commitMessage: `Handmatig goedgekeurd en gemerged door de eigenaar vanuit de app ("Goedkeuring & Mergen") nadat de qa-rol alle succescriteria van missie "${mission.title}" had goedgekeurd, maar de risicoclassificatie eerst eigen goedkeuring vereiste.`,
    });
  } catch (error) {
    const detail = error instanceof GithubApiError ? error.message : String(error);
    throw new DirectorRuntimeError(
      "MERGE_FAILED",
      `Het mergen van pull request #${pr.number} ("${pr.title}") is mislukt: ${detail}. Bekijk en merge de pull request zelf op GitHub: ${pr.url}`,
    );
  }

  return { pullRequestNumber: pr.number, pullRequestUrl: pr.url };
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
/**
 * Zet een herstelpoging uit als gewone builder-toewijzing.
 *
 * Bewust via hetzelfde `applyDirectorDecision` als elk ander besluit: dan
 * gelden dezelfde statusovergangen, dezelfde versiecontrole en dezelfde
 * gebeurtenissen in de missiegeschiedenis. Het enige verschil is dat dit
 * besluit niet van het taalmodel komt maar van een vaste regel — en dat het
 * `assignmentKind` meegeeft, zodat de volgende ronde kan tellen hoeveel
 * pogingen er al zijn geweest, per soort apart.
 */
async function dispatchRepair({
  engine,
  mission,
  actor,
  repair,
}: {
  engine: MissionEngine;
  mission: MissionV2;
  actor: ActorRef;
  repair: MissionRepairPlan;
}): Promise<RunDirectorStepResult> {
  const now = new Date().toISOString();

  const decision: DirectorDecision = {
    decisionId: randomUUID(),
    missionId: mission.missionId,
    decisionType: "DISPATCH_ROLE",
    reason: repair.reason,
    nextAction: repair.objective,
    assignedRole: "builder",
    assignmentKind: repair.kind,
    requiredCapabilities: [],
    contextRequirements: [],
    modelConstraints: {},
    approvalRequirement: "none",
    successCriteria: mission.successCriteria.map((criterion) => criterion.description),
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

  // Geen kennisophaling en geen LLM-aanroep: dit besluit staat vast, dus
  // context verzamelen zou alleen tijd en geld kosten zonder iets te
  // veranderen aan de uitkomst.
  return { mission: updated, decision, usedKnowledge: [] };
}

/**
 * Stelt de eigenaar een vraag over precies één succescriterium (stap 12b),
 * via hetzelfde `applyDirectorDecision` als elk ander besluit — zie
 * dispatchRepair hierboven voor waarom. Het verschil: dit besluit zet de
 * missie niet weer aan het werk (geen nieuwe toewijzing), maar naar
 * WAITING_FOR_OWNER (zie de REQUEST_OWNER_INPUT-afhandeling in engine.ts),
 * met `relatedCriterionId` erbij zodat het antwoord van de eigenaar
 * (recordOwnerInput) precies dat criterium kan bijwerken.
 */
async function dispatchOwnerClarification({
  engine,
  mission,
  actor,
  plan,
}: {
  engine: MissionEngine;
  mission: MissionV2;
  actor: ActorRef;
  plan: OwnerClarificationPlan;
}): Promise<RunDirectorStepResult> {
  const now = new Date().toISOString();

  const decision: DirectorDecision = {
    decisionId: randomUUID(),
    missionId: mission.missionId,
    decisionType: "REQUEST_OWNER_INPUT",
    reason:
      "QA kon dit succescriterium niet vaststellen, of de inhoudelijke herstellus (stap 12) is uitgeput — de Director vraagt het daarom aan de eigenaar in plaats van te stoppen (stap 12b).",
    nextAction: plan.question,
    relatedCriterionId: plan.relatedCriterionId,
    requiredCapabilities: [],
    contextRequirements: [],
    modelConstraints: {},
    approvalRequirement: "owner",
    successCriteria: [plan.relatedCriterionDescription],
    failureStrategy: "Wacht op het antwoord van de eigenaar (WAITING_FOR_OWNER).",
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

  // Zelfde reden als bij dispatchRepair: dit besluit staat vast, geen
  // kennisophaling of LLM-aanroep nodig.
  return { mission: updated, decision, usedKnowledge: [] };
}

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

  // Herstellussen (roadmapstap 11 en 12) en, sinds stap 12b, een vraag aan de
  // eigenaar wanneer QA twijfelt of het herstelplafond is bereikt. Staan
  // bewust vóór alles wat het taalmodel doet: zolang de CI rood is, QA een
  // criterium heeft afgekeurd, of QA het niet kon vaststellen, is elk ander
  // besluit — QA opnieuw laten oordelen, mergen, de missie afronden —
  // voorbarig. En elke lus heeft een plafond, wat een LLM-afweging per
  // definitie niet heeft.
  //
  // Alleen wanneer er geen toewijzing meer loopt: anders is de stand van dit
  // moment nog geen oordeel over werk dat nog bezig is.
  if (mission.activeAssignmentIds.length === 0) {
    const plan = await planMissionRepair(mission);

    if (plan) {
      return plan.kind === "OWNER_CLARIFICATION"
        ? dispatchOwnerClarification({ engine, mission, actor, plan })
        : dispatchRepair({ engine, mission, actor, repair: plan });
    }
  }

  const allowComplete = hasPassedAllCriteria(mission) && mission.activeAssignmentIds.length === 0;

  if (allowComplete) {
    await ensureMissionPullRequestMerged(mission);
  }

  // Stap 17: kennis én bewijs van de vorige stappen worden naast elkaar
  // opgehaald — het zijn twee onafhankelijke bronnen en er is geen reden om
  // op de ene te wachten voordat de andere begint. `gatherPullRequestEvidence`
  // faalt bewust nooit: bij een onbereikbare GitHub geeft hij null terug en
  // beslist de Director met minder bewijs, in plaats van dat de missie stilvalt.
  const [usedKnowledge, pullRequestEvidence] = await Promise.all([
    gatherRelevantKnowledge(mission),
    gatherPullRequestEvidence(mission),
  ]);

  const llmDecision = await decideNextStep(
    mission,
    allowComplete,
    usedKnowledge,
    pullRequestEvidence,
  );
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

  if (updated.status === "COMPLETED") {
    await proposeMissionKnowledge(updated, "completed");
  }

  return { mission: updated, decision, usedKnowledge };
}