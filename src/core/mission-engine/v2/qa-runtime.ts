import { randomUUID } from "node:crypto";

import type { RoleResult } from "@/core/contracts/v2";
import { getChatProvider } from "@/core/llm/model-router";

import {
  compareBranches,
  getDefaultBranch,
  getFileContent,
  getGithubRepoTarget,
  getPullRequestFiles,
  listPullRequests,
  type GithubRepoTarget,
  type PullRequestFileChange,
  type PullRequestSummary,
} from "./github/github-client";
import type { MissionV2 } from "./mission";

/**
 * QA Runtime v0 — de eerste versie van de QA-rol die daadwerkelijk oordeelt
 * of een pull request van de Builder-rol de succescriteria van een missie
 * haalt, in plaats van dat de Director dit zelf (zonder de code gezien te
 * hebben) aanneemt.
 *
 * Werkwijze:
 * 1. Vindt de pull request die bij deze missie hoort. Dat gebeurt via de
 *    branchnaam die de Builder-rol aanmaakt (`director/mission-<id>-...`,
 *    zie builder-runtime.ts) — niet via tekstuele koppeling met de Director,
 *    omdat Mission Engine V2 de volledige inhoud van een RoleResult nog niet
 *    ergens doorzoekbaar bewaart (zie engine.ts, recordRoleResult/commit).
 * 2. Is er geen pull request gevonden? Dan gooit dit een duidelijke fout
 *    (net als de Builder-rol doet bij haar eigen tijdelijke problemen) in
 *    plaats van een FAILED RoleResult vast te leggen. Zo blijft de
 *    toewijzing actief staan — de eigenaar kan na het aanmaken van de pull
 *    request simpelweg opnieuw op dezelfde knop klikken. Een FAILED
 *    RoleResult zou de mission naar REPLANNING zetten, een status waar noch
 *    de Director noch de huidige dashboard-knop automatisch uit verder komt.
 * 3. QA hoeft NIET meer te wachten tot een pull request gemergd is (zie de
 *    correctie hieronder) — ze haalt de gewijzigde bestanden (diff) én de
 *    volledige inhoud daarvan op de PR-branch zelf op, en laat een LLM, met
 *    een strikte QA-houding, per succescriterium van de missie beoordelen of
 *    het gehaald is. De toewijzing zelf is dan altijd COMPLETED (QA heeft
 *    haar werk gedaan) — de daadwerkelijke uitkomst zit in de per-criterium
 *    PASSED/FAILED verdicts, niet in de status van de toewijzing.
 *
 * Bewust beperkt (v0), zelfde geest als de rest van Mission Engine V2:
 * - beoordeelt alleen de meest recente pull request van deze missie;
 * - géén automatische re-run wanneer een pull request na afkeuring wordt
 *   aangepast; de Director moet dan opnieuw de builder-rol inzetten.
 *
 * Belangrijke correctie #1 (na een live misser): QA beoordeelde criteria
 * aanvankelijk uitsluitend op basis van de diff/patch van dé ene pull
 * request die op dat moment beoordeeld werd. Voor een missie die in meerdere
 * pull requests wordt afgerond (bijvoorbeeld: PR A bouwt de hoofdstructuur,
 * PR B repareert daarna nog één afgekeurd criterium) toont de diff van PR B
 * alléén de kleine vervolgwijziging — niet de structuur die PR A al had
 * neergezet. QA zag dan geen "bewijs" voor criteria die in werkelijkheid
 * allang klopten, en keurde ze onterecht af. QA haalt daarom nu, per
 * gewijzigd bestand, ook de VOLLEDIGE INHOUD op en beoordeelt daarop — de
 * diff van de specifieke pull request blijft daarnaast beschikbaar als
 * aanvullende context (bijvoorbeeld om te zien of een verboden bestand niet
 * is aangepast), maar is niet meer de enige bron van waarheid. Zie ook de
 * les "nooit de 'huidige inhoud' van een bestand stilzwijgend afkappen voor
 * een LLM" — dezelfde discipline geldt hier: bij een te groot bestand faalt
 * dit expliciet in plaats van stilzwijgend een deel van de inhoud weg te
 * knippen.
 *
 * Belangrijke correctie #2 (bewuste architectuurwijziging, geen bugfix): de
 * VOLLEDIGE INHOUD hierboven werd aanvankelijk opgehaald van de
 * standaardbranch (bv. "main") — dat loste correctie #1 op, maar had als
 * onbedoeld neveneffect dat QA alleen ZINVOL kon oordelen NADAT de eigenaar
 * de pull request al zelf had gemerged. QA kon dus per definitie geen
 * "voordat we mergen"-oordeel meer geven. Sinds deze correctie haalt QA de
 * volledige bestandsinhoud op van de PR-BRANCH ZELF (`pr.headSha`, zie
 * github-client.ts) in plaats van de standaardbranch — dat geeft dezelfde
 * volledige, kloppende bestandsinhoud, maar dan zoals die eruit zou zien
 * ZODRA deze pull request gemerged wordt, zonder dat er al gemerged hoeft te
 * zijn. QA werkt dus nu op elke openstaande pull request, niet meer alleen
 * op al-gemergde.
 *
 * Eén restrisico daarbij: de Builder-rol maakt elke nieuwe branch weliswaar
 * altijd aan vanaf de op dát moment actuele standaardbranch (zie
 * builder-runtime.ts, `getBranchHeadSha`), maar als er ná het aanmaken van
 * die branch nog iets anders naar de standaardbranch wordt gemerged, mist de
 * PR-branch die latere wijziging — exact hetzelfde soort onvolledige-bewijs-
 * probleem als correctie #1, nu vanuit de andere richting. Daarom controleert
 * `executeQaAssignment` hieronder, vóórdat ze een nog-niet-gemergde PR-branch
 * als bewijs gebruikt, expliciet via `compareBranches` of die branch nog wel
 * gelijk loopt met de standaardbranch — loopt de branch achter, dan faalt dit
 * expliciet met een duidelijke foutmelding (bijwerken en opnieuw proberen) in
 * plaats van stilzwijgend een onvolledig oordeel te geven.
 */

/**
 * Geëxporteerd (niet langer module-lokaal) omdat director-runtime.ts dit nu
 * ook nodig heeft: vóórdat een missie op COMPLETED mag, moet zij kunnen
 * controleren of de bijbehorende pull request al gemerged is — zie de
 * toelichting bij `findUnmergedCompletionBlocker` in director-runtime.ts.
 */
export const QA_BRANCH_PREFIX = (missionId: string) => `director/mission-${missionId.slice(0, 8)}-`;
const MAX_FILES_CONSIDERED = 40;
/**
 * Zelfde grens en dezelfde reden als MAX_FILE_CONTENT_LENGTH in
 * builder-runtime.ts: groot genoeg voor praktisch elk bestand in dit
 * project, en bij overschrijding faalt dit hard met een duidelijke
 * foutmelding in plaats van de inhoud stilzwijgend af te kappen.
 */
const MAX_FILE_CONTENT_LENGTH = 300_000;

type AssignmentRecord = MissionV2["assignments"][number];

export interface CriterionVerdict {
  criterionId: string;
  passed: boolean;
  reason: string;
}

export interface ExecuteQaAssignmentInput {
  mission: MissionV2;
  assignment: AssignmentRecord;
}

export interface ExecuteQaAssignmentOutput {
  result: RoleResult;
  roleOutput: string;
  criteriaVerdicts: CriterionVerdict[];
}

function buildQaSystemPrompt(mission: MissionV2): string {
  return [
    "Je bent de QA-rol binnen The Dost Matrix, een persoonlijk AI-besturingssysteem.",
    `Je beoordeelt of een pull request voor de missie "${mission.title}" (doel: ${mission.objective}) daadwerkelijk aan de succescriteria voldoet — dit mag zowel vóór als na het mergen van die pull request.`,
    "Je krijgt per gewijzigd bestand zowel de VOLLEDIGE INHOUD VAN DAT BESTAND OP DE PULL REQUEST-BRANCH (dus zoals het bestand eruit zou zien zodra deze pull request gemerged wordt, inclusief alles wat in eerdere, al gemergede pull requests van dezelfde missie is gerealiseerd) als de DIFF van specifiek déze pull request.",
    "Beoordeel elk succescriterium op basis van de VOLLEDIGE INHOUD — dat is de bron van waarheid. Gebruik de diff alleen als aanvullende context, bijvoorbeeld om te controleren wat er in déze pull request specifiek is gewijzigd.",
    "Een criterium mag GEHAALD zijn ook wanneer het niet zichtbaar is in de diff van déze pull request, zolang het wél klopt in de volledige inhoud (bijvoorbeeld omdat het al in een eerdere, gemergede pull request van dezelfde missie is gerealiseerd). Keur nooit af puur omdat 'de diff het niet aantoont' terwijl de volledige inhoud het criterium wél waarmaakt.",
    "Wees streng en eerlijk: keur alleen goed wat je in de daadwerkelijke bestandsinhoud kunt onderbouwen. Bij twijfel: afkeuren, niet het voordeel van de twijfel geven.",
    "Je mag naast de per-criterium oordelen ook één algemene 'recommendation' geven. Onderscheid daarbij expliciet twee soorten: (a) een puur cosmetische of optionele suggestie die niets aan de daadwerkelijke werking of het doel van de missie verandert (bijvoorbeeld een stijlvoorkeur) — zet dan recommendationBlocksCompletion op false; (b) een concreet, aanwijsbaar gebrek dat een succescriterium in de praktijk breekt of onvolledig maakt (bijvoorbeeld een klassenaam die niet overeenkomt tussen twee bestanden waardoor bedoelde styling niet wordt toegepast) — zet dan recommendationBlocksCompletion op true EN geef in recommendationCriterionId het criterionId van het succescriterium waar dit gebrek het meest op van toepassing is. Wees hier terughoudend en eerlijk: gebruik recommendationBlocksCompletion=true uitsluitend voor een echt gebrek dat de eigenaar zou willen laten oplossen vóórdat dit wordt afgerond, nooit voor smaakkwesties.",
    "Antwoord UITSLUITEND met geldige JSON, zonder uitleg of markdown eromheen.",
  ].join(" ");
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("De QA-rol gaf geen JSON-object terug in haar antwoord.");
  }

  return text.slice(start, end + 1);
}

export function findMissionPullRequest(
  prs: PullRequestSummary[],
  missionId: string,
): PullRequestSummary | null {
  const prefix = QA_BRANCH_PREFIX(missionId);
  const matches = prs
    .filter((pr) => pr.headRef.startsWith(prefix))
    .sort((a, b) => b.number - a.number);

  return matches[0] ?? null;
}

function buildResult(input: {
  assignment: AssignmentRecord;
  mission: MissionV2;
  status: RoleResult["status"];
  summary: string;
  roleOutput: string;
  successCriteriaResults: Record<string, boolean>;
  artifactRefs: string[];
  model?: string;
  durationMs: number;
}): RoleResult {
  const { assignment, mission, status, summary, successCriteriaResults, artifactRefs, model, durationMs } =
    input;

  return {
    resultId: randomUUID(),
    assignmentId: assignment.assignmentId,
    missionId: mission.missionId,
    status,
    summary: summary.slice(0, 500),
    deliverables: [],
    evidence: [],
    assumptions: [],
    uncertainties: [],
    risks: [],
    recommendations: [],
    successCriteriaResults,
    artifactRefs,
    usage: {
      provider: model ? getChatProvider().id : undefined,
      model,
      durationMs,
    },
    createdAt: new Date().toISOString(),
  };
}

interface QaLlmVerdict {
  overallSummary: string;
  criteria: { criterionId: string; passed: boolean; reason: string }[];
  recommendation: string;
  /**
   * Wanneer waar (en `recommendation` niet leeg is), betekent dit dat QA een
   * concreet, aanwijsbaar gebrek heeft gevonden dat niet mag worden genegeerd
   * — zie `applyBlockingRecommendation` hieronder, die dit vertaalt naar een
   * FAILED-status op het meest relevante succescriterium. Dit is bewust
   * ingebouwd nadat de eigenaar aangaf dat een door QA gesignaleerd gebrek
   * (een CSS-klassenaam-mismatch die per ongeluk als "GEHAALD, met een
   * aandachtspunt" werd doorgelaten) altijd eerst door de builder-rol
   * verholpen moet worden — nooit alleen als vrijblijvende suggestie in de
   * UI blijven staan terwijl de missie toch al voltooid mag worden.
   */
  recommendationBlocksCompletion: boolean;
  recommendationCriterionId: string;
}

interface QaFileEvidence {
  filename: string;
  status: string;
  patch?: string;
  fullContent: string | null;
}

/**
 * Haalt, voor elk gewijzigd bestand van de pull request, de VOLLEDIGE INHOUD
 * op van het opgegeven `ref` — in de praktijk de PR-branch zelf (`pr.headSha`,
 * zie de aanroep in `executeQaAssignment`), zodat QA ook vóór het mergen al
 * de volledige, kloppende bestandsinhoud ziet in plaats van alleen een diff.
 * Bestanden met status "removed" worden overgeslagen (die bestaan per
 * definitie niet meer op deze ref). Faalt expliciet bij een te groot bestand
 * — zie de uitleg bovenaan dit bestand over waarom stilzwijgend afkappen
 * hier bewust niet gebeurt.
 */
async function fetchFullFileContents(
  target: GithubRepoTarget,
  files: PullRequestFileChange[],
  ref: string,
): Promise<QaFileEvidence[]> {
  const evidence: QaFileEvidence[] = [];

  for (const file of files) {
    if (file.status === "removed") {
      evidence.push({ ...file, fullContent: null });
      continue;
    }

    const fetched = await getFileContent(target, file.filename, ref);

    if (fetched && fetched.content.length > MAX_FILE_CONTENT_LENGTH) {
      throw new Error(
        `Het bestand "${file.filename}" is ${fetched.content.length} tekens lang — groter dan de QA-limiet van ${MAX_FILE_CONTENT_LENGTH} tekens. QA weigert bewust stilzwijgend af te kappen; verhoog MAX_FILE_CONTENT_LENGTH in qa-runtime.ts als dit een legitiem groot bestand is.`,
      );
    }

    evidence.push({ ...file, fullContent: fetched?.content ?? null });
  }

  return evidence;
}

function formatEvidenceForPrompt(evidence: QaFileEvidence[]): string {
  return evidence
    .map((file) => {
      const parts = [`### ${file.filename} (${file.status})`];

      parts.push(
        file.fullContent !== null
          ? `VOLLEDIGE INHOUD OP DE PULL REQUEST-BRANCH:\n${file.fullContent}`
          : "(bestand is verwijderd of de inhoud kon niet worden opgehaald)",
      );

      parts.push(`DIFF van specifiek déze pull request:\n${file.patch ?? "(geen tekstuele diff beschikbaar)"}`);

      return parts.join("\n\n");
    })
    .join("\n\n---\n\n");
}

async function evaluateCriteriaAgainstEvidence(
  mission: MissionV2,
  pr: PullRequestSummary,
  evidenceText: string,
): Promise<{ verdict: QaLlmVerdict; model: string }> {
  const provider = getChatProvider();

  const criteriaLines = mission.successCriteria
    .map((criterion) => `- criterionId="${criterion.criterionId}": ${criterion.description}`)
    .join("\n");

  const userPrompt = [
    `Pull request #${pr.number}: "${pr.title}" (${pr.url})`,
    "",
    "Succescriteria van de missie (beoordeel ELK criterium apart, gebruik het exacte criterionId):",
    criteriaLines,
    "",
    "Bewijsmateriaal per gewijzigd bestand (huidige volledige inhoud + diff van déze pull request):",
    evidenceText,
    "",
    "Antwoord exact in dit JSON-formaat, niets anders:",
    "{",
    '  "overallSummary": "korte samenvatting van je beoordeling",',
    '  "criteria": [',
    '    { "criterionId": "...", "passed": true, "reason": "korte onderbouwing" }',
    "  ],",
    '  "recommendation": "korte aanbeveling voor de eigenaar, of een lege string als er niets te melden valt",',
    '  "recommendationBlocksCompletion": false,',
    '  "recommendationCriterionId": "criterionId waar de aanbeveling het meest op van toepassing is (alleen verplicht wanneer recommendationBlocksCompletion true is)"',
    "}",
  ].join("\n");

  const completion = await provider.chatCompletion(buildQaSystemPrompt(mission), [
    { role: "user", content: userPrompt },
  ]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(completion.content));
  } catch {
    throw new Error("De QA-rol gaf geen geldig oordeel terug (kon het antwoord niet als JSON lezen).");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("De QA-rol gaf een onverwacht oordeel terug.");
  }

  const candidate = parsed as Partial<QaLlmVerdict>;

  const validCriterionIds = new Set(mission.successCriteria.map((criterion) => criterion.criterionId));

  const criteria = Array.isArray(candidate.criteria)
    ? candidate.criteria.filter(
        (entry): entry is QaLlmVerdict["criteria"][number] =>
          !!entry &&
          typeof entry.criterionId === "string" &&
          validCriterionIds.has(entry.criterionId) &&
          typeof entry.passed === "boolean",
      )
    : [];

  if (criteria.length === 0) {
    throw new Error(
      "De QA-rol kon geen van de succescriteria beoordelen (geen geldige criterionId's in het antwoord).",
    );
  }

  return {
    verdict: {
      overallSummary:
        typeof candidate.overallSummary === "string" && candidate.overallSummary.trim()
          ? candidate.overallSummary.trim()
          : "Geen samenvatting opgegeven.",
      criteria: criteria.map((entry) => ({
        criterionId: entry.criterionId,
        passed: entry.passed,
        reason: typeof entry.reason === "string" && entry.reason.trim() ? entry.reason.trim() : "Geen onderbouwing opgegeven.",
      })),
      recommendation:
        typeof candidate.recommendation === "string" && candidate.recommendation.trim()
          ? candidate.recommendation.trim()
          : "",
      recommendationBlocksCompletion: candidate.recommendationBlocksCompletion === true,
      recommendationCriterionId:
        typeof candidate.recommendationCriterionId === "string" &&
        validCriterionIds.has(candidate.recommendationCriterionId)
          ? candidate.recommendationCriterionId
          : "",
    },
    model: completion.model,
  };
}

/**
 * Vertaalt een blokkerende QA-aanbeveling (zie QaLlmVerdict hierboven) naar
 * een FAILED-verdict op het meest relevante succescriterium — ook wanneer
 * de LLM dat criterium zelf al als GEHAALD had beoordeeld. Dit is de
 * daadwerkelijke handhaving van de eigenaar-wens: een concreet gebrek dat QA
 * signaleert mag nooit alleen als vrijblijvende opmerking in de UI
 * verschijnen terwijl de missie via `hasPassedAllCriteria` (mission.ts) toch
 * al afgerond zou mogen worden. Door hier het onderliggende criterium op
 * FAILED te zetten (met de aanbeveling als `reason`, die later als
 * `lastEvaluationNote` wordt opgeslagen — zie role-runtime.ts), blijft
 * `hasPassedAllCriteria` vanzelf false totdat een nieuwe builder-toewijzing
 * dit verholpen heeft en QA opnieuw akkoord geeft. Geen wijziging nodig aan
 * mission.ts, engine.ts of director-runtime.ts: dit hergebruikt volledig het
 * bestaande FAILED-criterium-mechanisme.
 *
 * Is er geen valide `recommendationCriterionId` opgegeven (de LLM vergat
 * hem, of gaf een onbekend criterionId), dan valt dit terug op het eerst
 * beoordeelde criterium — beter een enigszins arbitraire, maar wél
 * afdwingende koppeling dan de aanbeveling stilzwijgend laten vervallen.
 */
function applyBlockingRecommendation(
  criteria: QaLlmVerdict["criteria"],
  verdict: QaLlmVerdict,
): QaLlmVerdict["criteria"] {
  if (!verdict.recommendation || !verdict.recommendationBlocksCompletion) {
    return criteria;
  }

  const targetId = verdict.recommendationCriterionId || criteria[0]?.criterionId;
  const targetIndex = criteria.findIndex((entry) => entry.criterionId === targetId);

  if (targetIndex === -1) {
    return criteria;
  }

  const target = criteria[targetIndex];
  const updated = [...criteria];
  updated[targetIndex] = {
    ...target,
    passed: false,
    reason: target.passed
      ? `QA-aanbeveling vereist eerst actie voordat dit criterium als gehaald mag gelden: ${verdict.recommendation} (oorspronkelijke beoordeling van dit criterium op zich: "${target.reason}")`
      : `${target.reason} Daarnaast: ${verdict.recommendation}`,
  };

  return updated;
}

/**
 * Voert een toewijzing van de QA-rol uit: vindt de bijbehorende pull request
 * op GitHub en laat een LLM per succescriterium een PASSED/FAILED-oordeel
 * vellen op basis van de volledige inhoud van de gewijzigde bestanden zoals
 * die op de PR-branch zelf staat (aangevuld met de diff van déze specifieke
 * pull request als context) — dit werkt zowel vóór als na het mergen; zie de
 * uitleg bovenaan dit bestand ("Belangrijke correctie #2") voor waarom.
 *
 * Net als de Builder-rol (zie builder-runtime.ts) gooit dit een duidelijke
 * fout wanneer er nog geen bruikbare pull request is, of wanneer een nog
 * niet gemergde PR-branch inmiddels achterloopt op de standaardbranch (zie
 * de `compareBranches`-controle hieronder) — dit zijn normale, verwachte,
 * tijdelijke situaties, GEEN mislukking van de QA-toewijzing zelf. Door hier
 * te gooien in plaats van een FAILED RoleResult vast te leggen, blijft de
 * toewijzing actief (mission blijft WAITING_FOR_ROLE) zodat de eigenaar het
 * na het oplossen simpelweg opnieuw kan proberen via dezelfde knop — een
 * FAILED RoleResult zou de mission naar REPLANNING zetten, een status waar
 * de Director (en de huidige dashboard-knop) niet automatisch uit verder
 * komt.
 */
export async function executeQaAssignment({
  mission,
  assignment,
}: ExecuteQaAssignmentInput): Promise<ExecuteQaAssignmentOutput> {
  const startedAt = Date.now();
  const target = getGithubRepoTarget();

  const prs = await listPullRequests(target, "all");
  const pr = findMissionPullRequest(prs, mission.missionId);

  if (!pr) {
    throw new Error(
      "Geen pull request gevonden die bij deze missie hoort. De Builder-rol moet eerst een pull request openen voordat QA kan beoordelen — probeer het na het aanmaken van de pull request opnieuw.",
    );
  }

  if (!pr.merged) {
    const defaultBranch = await getDefaultBranch(target);
    const comparison = await compareBranches(target, defaultBranch, pr.headRef);

    if (comparison.behindBy > 0) {
      throw new Error(
        `Pull request #${pr.number} ("${pr.title}") loopt ${comparison.behindBy} commit(s) achter op de standaardbranch "${defaultBranch}" — er is dus, ná het aanmaken van deze branch, al iets anders naar "${defaultBranch}" gemerged. QA kan op basis van deze verouderde branch geen volledig betrouwbaar oordeel geven. Werk de branch eerst bij (bijvoorbeeld door "${defaultBranch}" erin te mergen) en probeer het daarna opnieuw: ${pr.url}`,
      );
    }
  }

  const files = await getPullRequestFiles(target, pr.number);
  const evidence = await fetchFullFileContents(target, files.slice(0, MAX_FILES_CONSIDERED), pr.headSha);
  const evidenceText = formatEvidenceForPrompt(evidence);

  const { verdict, model } = await evaluateCriteriaAgainstEvidence(mission, pr, evidenceText);
  const effectiveCriteria = applyBlockingRecommendation(verdict.criteria, verdict);
  const wasOverridden = effectiveCriteria !== verdict.criteria;

  const successCriteriaResults: Record<string, boolean> = {};
  for (const entry of effectiveCriteria) {
    successCriteriaResults[entry.criterionId] = entry.passed;
  }

  const roleOutput = [
    verdict.overallSummary,
    "",
    ...effectiveCriteria.map(
      (entry) => `- (${entry.passed ? "GEHAALD" : "NIET GEHAALD"}) ${entry.criterionId}: ${entry.reason}`,
    ),
    verdict.recommendation
      ? `\nAanbeveling: ${verdict.recommendation}${
          wasOverridden
            ? " — LET OP: hierdoor is een succescriterium hierboven bewust op NIET GEHAALD gezet, ook al leek de inhoud op zich in orde. De missie kan pas weer voltooid worden nadat de builder-rol dit heeft opgelost en QA opnieuw akkoord geeft."
            : ""
        }`
      : "",
    pr.merged
      ? `\nBeoordeeld op basis van pull request #${pr.number} (al gemerged): ${pr.url}`
      : `\nBeoordeeld op basis van pull request #${pr.number} (NOG NIET gemerged — dit is een beoordeling vóóraf): ${pr.url}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  const result = buildResult({
    assignment,
    mission,
    status: "COMPLETED",
    summary: verdict.overallSummary,
    roleOutput,
    successCriteriaResults,
    artifactRefs: [pr.url],
    model,
    durationMs: Date.now() - startedAt,
  });

  const criteriaVerdicts: CriterionVerdict[] = effectiveCriteria.map((entry) => ({
    criterionId: entry.criterionId,
    passed: entry.passed,
    reason: entry.reason,
  }));

  return { result, roleOutput, criteriaVerdicts };
}
