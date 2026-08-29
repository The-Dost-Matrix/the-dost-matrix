import { randomUUID } from "node:crypto";

import type { RoleResult } from "@/core/contracts/v2";
import { getChatProvider } from "@/core/llm/model-router";

import {
  createBranch,
  createPullRequest,
  getBranchHeadSha,
  getDefaultBranch,
  getFileContent,
  getGithubRepoTarget,
  getRepoTree,
  upsertFile,
} from "./github/github-client";
import type { MissionV2 } from "./mission";

/**
 * Builder Runtime v0 — de eerste versie van de Builder-rol die daadwerkelijk
 * bestanden aanpast, in plaats van alleen een plan te beschrijven (zoals de
 * oudere, tekst-only uitvoering in role-runtime.ts deed).
 *
 * Werkwijze, in lijn met de architectuurbeslissing dat agents nooit
 * rechtstreeks bestanden op de pc van de eigenaar aanraken: de Builder werkt
 * uitsluitend via de GitHub-repository. Hij leest de actuele bestandsboom en
 * de betrokken bestanden op via de GitHub API, laat een LLM de nieuwe inhoud
 * bepalen, en zet die klaar als een nieuwe branch met een pull request. Er
 * wordt nooit rechtstreeks naar de standaardbranch geschreven — de eigenaar
 * beoordeelt en merget de pull request zelf, er gebeurt niets automatisch.
 *
 * Bewust beperkt (v0), zelfde geest als de rest van Mission Engine V2:
 * - maximaal 8 bestanden per toewijzing;
 * - geen automatische QA-beoordeling van de wijziging (successCriteriaResults
 *   blijft leeg, net als bij de oude Role Runtime — dat is werk voor een
 *   toekomstige QA-rol);
 * - de Director ziet op dit moment de inhoud van dit resultaat (dus ook niet
 *   of de pull request al gemerged is) nog niet terug bij een volgende
 *   beslissing — hij ziet alleen dat de toewijzing is afgerond. Tot de
 *   QA-rol er is, blijft handmatig controleren van de pull request op
 *   GitHub dus nodig, ongeacht wat de missiestatus zegt.
 */

const MAX_FILES_PER_ASSIGNMENT = 8;
const MAX_TREE_LENGTH = 20_000;
const MAX_FILE_CONTENT_LENGTH = 20_000;

type AssignmentRecord = MissionV2["assignments"][number];

function buildBuilderSystemPrompt(mission: MissionV2): string {
  return [
    "Je bent de Builder-rol binnen The Dost Matrix, een persoonlijk AI-besturingssysteem.",
    `Je werkt aan de missie "${mission.title}" (doel: ${mission.objective}).`,
    "Je past de GitHub-repository van dit project aan door bestanden te lezen en te schrijven; je wijzigingen komen terecht in een pull request die de eigenaar zelf beoordeelt en merget.",
    "Antwoord UITSLUITEND met geldige JSON, zonder uitleg of markdown eromheen.",
  ].join(" ");
}

function buildAssignmentDescription(mission: MissionV2, assignment: AssignmentRecord): string {
  const lines = [
    `Opdracht: ${assignment.objective}`,
    "",
    "Succescriteria voor deze toewijzing:",
    ...assignment.successCriteria.map((criterion) => `- ${criterion}`),
  ];

  if (mission.constraints.length > 0) {
    lines.push("", "Randvoorwaarden van de missie:");
    lines.push(...mission.constraints.map((constraint) => `- ${constraint}`));
  }

  return lines.join("\n");
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

interface BuilderPlan {
  paths: string[];
  planSummary: string;
}

async function planFiles(
  mission: MissionV2,
  assignment: AssignmentRecord,
  treeText: string,
): Promise<BuilderPlan> {
  const provider = getChatProvider();

  const userPrompt = [
    buildAssignmentDescription(mission, assignment),
    "",
    `Actuele bestandsboom van de repository (ingekort tot ${MAX_TREE_LENGTH} tekens indien nodig):`,
    treeText.slice(0, MAX_TREE_LENGTH),
    "",
    `Geef een lijst van maximaal ${MAX_FILES_PER_ASSIGNMENT} bestandspaden (relatief aan de root van de repository) die je moet aanmaken of aanpassen om deze opdracht te voltooien. Gebruik alleen paden die logisch passen bij de bestaande structuur hierboven.`,
    "",
    "Antwoord exact in dit JSON-formaat, niets anders:",
    "{",
    '  "planSummary": "korte beschrijving van je aanpak",',
    '  "paths": ["src/..."]',
    "}",
  ].join("\n");

  const completion = await provider.chatCompletion(buildBuilderSystemPrompt(mission), [
    { role: "user", content: userPrompt },
  ]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(completion.content));
  } catch {
    throw new Error("De Builder gaf geen geldig plan terug (kon het antwoord niet als JSON lezen).");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("De Builder gaf een onverwacht plan terug.");
  }

  const candidate = parsed as Partial<BuilderPlan>;

  const paths = Array.isArray(candidate.paths)
    ? candidate.paths
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim().replace(/^\/+/, ""))
        .slice(0, MAX_FILES_PER_ASSIGNMENT)
    : [];

  if (paths.length === 0) {
    throw new Error("De Builder kon geen bestanden bepalen om aan te passen voor deze opdracht.");
  }

  return {
    paths,
    planSummary:
      typeof candidate.planSummary === "string" && candidate.planSummary.trim()
        ? candidate.planSummary.trim()
        : "Geen samenvatting opgegeven.",
  };
}

interface PlannedFile {
  path: string;
  currentContent: string | null;
  currentSha?: string;
}

interface BuilderFileChange {
  path: string;
  content: string;
}

interface BuilderWriteResult {
  summary: string;
  pullRequestTitle: string;
  pullRequestBody: string;
  files: BuilderFileChange[];
  model: string;
}

async function writeFiles(
  mission: MissionV2,
  assignment: AssignmentRecord,
  plan: BuilderPlan,
  plannedFiles: PlannedFile[],
): Promise<BuilderWriteResult> {
  const provider = getChatProvider();

  const fileBlocks = plannedFiles
    .map((file) => {
      const status =
        file.currentContent === null ? "NIEUW BESTAND (bestaat nog niet)" : "BESTAAND BESTAND";
      const content =
        file.currentContent === null
          ? ""
          : `\n---\n${file.currentContent.slice(0, MAX_FILE_CONTENT_LENGTH)}\n---`;
      return `### ${file.path} (${status})${content}`;
    })
    .join("\n\n");

  const userPrompt = [
    buildAssignmentDescription(mission, assignment),
    "",
    `Jouw plan: ${plan.planSummary}`,
    "",
    "Huidige inhoud van de betrokken bestanden:",
    fileBlocks,
    "",
    "Geef nu de VOLLEDIGE nieuwe inhoud van elk bestand terug (niet alleen het verschil). Schrijf productiekwaliteit code die aansluit bij de bestaande stijl. Verzin geen bestanden buiten de lijst hierboven.",
    "",
    "Antwoord exact in dit JSON-formaat, niets anders:",
    "{",
    '  "summary": "korte beschrijving van wat je hebt gebouwd, voor in de missie-geschiedenis",',
    '  "pullRequestTitle": "korte titel voor de pull request",',
    '  "pullRequestBody": "beschrijving van de wijziging voor in de pull request",',
    '  "files": [{ "path": "src/...", "content": "volledige bestandsinhoud" }]',
    "}",
  ].join("\n");

  const completion = await provider.chatCompletion(buildBuilderSystemPrompt(mission), [
    { role: "user", content: userPrompt },
  ]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(completion.content));
  } catch {
    throw new Error(
      "De Builder gaf geen geldige bestandsinhoud terug (kon het antwoord niet als JSON lezen).",
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("De Builder gaf een onverwacht antwoord terug.");
  }

  const candidate = parsed as Partial<Omit<BuilderWriteResult, "model">>;

  const files = Array.isArray(candidate.files)
    ? candidate.files.filter(
        (entry): entry is BuilderFileChange =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as BuilderFileChange).path === "string" &&
          typeof (entry as BuilderFileChange).content === "string",
      )
    : [];

  if (files.length === 0) {
    throw new Error("De Builder gaf geen bestandsinhoud terug om weg te schrijven.");
  }

  return {
    summary:
      typeof candidate.summary === "string" && candidate.summary.trim()
        ? candidate.summary.trim()
        : plan.planSummary,
    pullRequestTitle:
      typeof candidate.pullRequestTitle === "string" && candidate.pullRequestTitle.trim()
        ? candidate.pullRequestTitle.trim()
        : `Director: ${mission.title}`,
    pullRequestBody:
      typeof candidate.pullRequestBody === "string" && candidate.pullRequestBody.trim()
        ? candidate.pullRequestBody.trim()
        : assignment.objective,
    files,
    model: completion.model,
  };
}

export interface ExecuteBuilderAssignmentInput {
  mission: MissionV2;
  assignment: AssignmentRecord;
}

export interface ExecuteBuilderAssignmentOutput {
  result: RoleResult;
  roleOutput: string;
}

/**
 * Voert een toewijzing van de Builder-rol daadwerkelijk uit: leest de
 * repository via GitHub, laat een LLM de wijzigingen bepalen, en zet die
 * klaar als pull request.
 *
 * Gooit een duidelijke fout wanneer GitHub niet bereikbaar is, de sleutel
 * ontbreekt, of de LLM geen bruikbaar antwoord geeft — de toewijzing blijft
 * dan actief staan (er wordt geen resultaat vastgelegd) zodat de eigenaar
 * het na het oplossen opnieuw kan proberen.
 */
export async function executeBuilderAssignment({
  mission,
  assignment,
}: ExecuteBuilderAssignmentInput): Promise<ExecuteBuilderAssignmentOutput> {
  const startedAt = Date.now();
  const target = getGithubRepoTarget();

  const defaultBranch = await getDefaultBranch(target);
  const baseSha = await getBranchHeadSha(target, defaultBranch);
  const tree = await getRepoTree(target, defaultBranch);

  const treeText = tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path)
    .sort()
    .join("\n");

  const plan = await planFiles(mission, assignment, treeText);

  const plannedFiles: PlannedFile[] = [];
  for (const path of plan.paths) {
    const existing = await getFileContent(target, path, defaultBranch);
    plannedFiles.push({
      path,
      currentContent: existing?.content ?? null,
      currentSha: existing?.sha,
    });
  }

  const writeResult = await writeFiles(mission, assignment, plan, plannedFiles);

  // Alleen bestanden schrijven die ook echt gepland waren — voorkomt dat de
  // tweede LLM-aanroep alsnog een bestand buiten de lijst van planFiles()
  // verzint en per ongeluk iets onbedoelds overschrijft of een sha-conflict
  // veroorzaakt.
  const plannedPaths = new Set(plan.paths);
  const filesToWrite = writeResult.files
    .filter((file) => plannedPaths.has(file.path))
    .slice(0, MAX_FILES_PER_ASSIGNMENT);

  if (filesToWrite.length === 0) {
    throw new Error(
      "De Builder gaf geen bruikbare bestandsinhoud terug binnen het geplande bestandenoverzicht.",
    );
  }

  const branchName = `director/mission-${mission.missionId.slice(0, 8)}-${Date.now()}`;
  await createBranch(target, branchName, baseSha);

  const shaByPath = new Map(plannedFiles.map((file) => [file.path, file.currentSha]));

  for (const file of filesToWrite) {
    await upsertFile(target, {
      path: file.path,
      content: file.content,
      message: `Director: ${assignment.objective}`.slice(0, 200),
      branch: branchName,
      sha: shaByPath.get(file.path),
    });
  }

  const pullRequest = await createPullRequest(target, {
    title: writeResult.pullRequestTitle,
    head: branchName,
    base: defaultBranch,
    body: [
      writeResult.pullRequestBody,
      "",
      `Missie: ${mission.title}`,
      `Toewijzing: ${assignment.objective}`,
      "",
      "Deze pull request is automatisch aangemaakt door de Builder-rol van Mission Engine V2. Beoordeel de wijzigingen en merge alleen wanneer je tevreden bent — er gebeurt niets automatisch.",
    ].join("\n"),
  });

  const durationMs = Date.now() - startedAt;
  const now = new Date().toISOString();

  const roleOutput = [
    writeResult.summary,
    "",
    `Bestanden aangepast: ${filesToWrite.map((file) => file.path).join(", ")}`,
    `Pull request geopend: ${pullRequest.url}`,
    "Deze wijziging is nog niet gemerged — beoordeel de pull request op GitHub en merge hem zelf wanneer je tevreden bent.",
  ].join("\n");

  const result: RoleResult = {
    resultId: randomUUID(),
    assignmentId: assignment.assignmentId,
    missionId: mission.missionId,
    status: "COMPLETED",
    summary: roleOutput.slice(0, 500),
    deliverables: [pullRequest.url],
    evidence: [],
    assumptions: [],
    uncertainties: [],
    risks: [],
    recommendations: ["Beoordeel de pull request op GitHub voordat je hem merget."],
    successCriteriaResults: {},
    artifactRefs: [pullRequest.url],
    usage: {
      provider: getChatProvider().id,
      model: writeResult.model,
      durationMs,
    },
    createdAt: now,
  };

  return { result, roleOutput };
}
