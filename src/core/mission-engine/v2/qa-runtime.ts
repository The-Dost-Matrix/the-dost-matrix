import { randomUUID } from "node:crypto";

import type { RoleResult } from "@/core/contracts/v2";
import { getChatProvider } from "@/core/llm/model-router";

import {
  getGithubRepoTarget,
  getPullRequestFiles,
  listPullRequests,
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
 * 2. Is er geen pull request gevonden, of is de gevonden pull request nog
 *    niet gemerged? Dan faalt deze toewijzing met een duidelijke reden, en
 *    worden er GEEN succescriteria aangepast — ze blijven op hun huidige
 *    status staan zodat de Director het later opnieuw kan proberen.
 * 3. Is de pull request gemerged? Dan haalt dit de gewijzigde bestanden
 *    (diff) op en laat een LLM, met een strikte QA-houding, per
 *    succescriterium van de missie beoordelen of het gehaald is. De
 *    toewijzing zelf is dan altijd COMPLETED (QA heeft haar werk gedaan) —
 *    de daadwerkelijke uitkomst zit in de per-criterium PASSED/FAILED
 *    verdicts, niet in de status van de toewijzing.
 *
 * Bewust beperkt (v0), zelfde geest als de rest van Mission Engine V2:
 * - beoordeelt alleen de meest recente pull request van deze missie;
 * - beoordeelt op basis van de diff (patches), niet de volledige
 *   bestandsinhoud — voor zeer grote pull requests kan dat onvolledig zijn;
 * - géén automatische re-run wanneer een pull request na afkeuring wordt
 *   aangepast; de Director moet dan opnieuw de builder-rol inzetten.
 */

const QA_BRANCH_PREFIX = (missionId: string) => `director/mission-${missionId.slice(0, 8)}-`;
const MAX_DIFF_LENGTH = 20_000;
const MAX_FILES_CONSIDERED = 40;

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
    `Je beoordeelt of een pull request voor de missie "${mission.title}" (doel: ${mission.objective}) daadwerkelijk aan de succescriteria voldoet.`,
    "Wees streng en eerlijk: keur alleen goed wat je in de diff daadwerkelijk kunt onderbouwen. Bij twijfel: afkeuren, niet het voordeel van de twijfel geven.",
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

function findMissionPullRequest(
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
}

async function evaluateCriteriaAgainstDiff(
  mission: MissionV2,
  pr: PullRequestSummary,
  diffText: string,
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
    `Diff van de pull request (ingekort tot ${MAX_DIFF_LENGTH} tekens indien nodig):`,
    diffText.slice(0, MAX_DIFF_LENGTH),
    "",
    "Antwoord exact in dit JSON-formaat, niets anders:",
    "{",
    '  "overallSummary": "korte samenvatting van je beoordeling",',
    '  "criteria": [',
    '    { "criterionId": "...", "passed": true, "reason": "korte onderbouwing" }',
    "  ],",
    '  "recommendation": "korte aanbeveling voor de eigenaar"',
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
    },
    model: completion.model,
  };
}

/**
 * Voert een toewijzing van de QA-rol uit: vindt de bijbehorende pull request
 * op GitHub, controleert of die gemerged is, en laat (pas dan) een LLM per
 * succescriterium een PASSED/FAILED-oordeel vellen op basis van de diff.
 *
 * In tegenstelling tot de Builder-rol gooit dit GEEN fout wanneer er (nog)
 * geen bruikbare pull request is — dat is een normale, verwachte uitkomst
 * (de eigenaar heeft simpelweg nog niet gemerged) en wordt afgehandeld als
 * een FAILED RoleResult met een duidelijke reden, zodat de Director weet dat
 * hij moet wachten of opnieuw moet plannen.
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
    const summary =
      "Geen pull request gevonden die bij deze missie hoort. De Builder-rol moet eerst een pull request openen voordat QA kan beoordelen.";
    return {
      result: buildResult({
        assignment,
        mission,
        status: "FAILED",
        summary,
        roleOutput: summary,
        successCriteriaResults: {},
        artifactRefs: [],
        durationMs: Date.now() - startedAt,
      }),
      roleOutput: summary,
      criteriaVerdicts: [],
    };
  }

  if (!pr.merged) {
    const summary = [
      `Pull request #${pr.number} ("${pr.title}") is nog niet gemerged.`,
      `Beoordeel en merge de pull request eerst zelf op GitHub voordat QA de succescriteria kan controleren: ${pr.url}`,
    ].join(" ");
    return {
      result: buildResult({
        assignment,
        mission,
        status: "FAILED",
        summary,
        roleOutput: summary,
        successCriteriaResults: {},
        artifactRefs: [pr.url],
        durationMs: Date.now() - startedAt,
      }),
      roleOutput: summary,
      criteriaVerdicts: [],
    };
  }

  const files = await getPullRequestFiles(target, pr.number);
  const diffText = files
    .slice(0, MAX_FILES_CONSIDERED)
    .map((file) => `### ${file.filename} (${file.status})\n${file.patch ?? "(geen tekstuele diff beschikbaar)"}`)
    .join("\n\n");

  const { verdict, model } = await evaluateCriteriaAgainstDiff(mission, pr, diffText);

  const successCriteriaResults: Record<string, boolean> = {};
  for (const entry of verdict.criteria) {
    successCriteriaResults[entry.criterionId] = entry.passed;
  }

  const roleOutput = [
    verdict.overallSummary,
    "",
    ...verdict.criteria.map(
      (entry) => `- (${entry.passed ? "GEHAALD" : "NIET GEHAALD"}) ${entry.criterionId}: ${entry.reason}`,
    ),
    verdict.recommendation ? `\nAanbeveling: ${verdict.recommendation}` : "",
    `\nBeoordeeld op basis van pull request #${pr.number}: ${pr.url}`,
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

  const criteriaVerdicts: CriterionVerdict[] = verdict.criteria.map((entry) => ({
    criterionId: entry.criterionId,
    passed: entry.passed,
    reason: entry.reason,
  }));

  return { result, roleOutput, criteriaVerdicts };
}
