import { randomUUID } from "node:crypto";

import type { ActorRef, DirectorDecision, DirectorDecisionType, JsonValue } from "@/core/contracts/v2";
import { getChatProvider } from "@/core/llm/model-router";
import { retrieveKnowledgeContext } from "@/core/application/knowledge/retrieval";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

import type { MissionEngine } from "./engine";
import type { MissionV2 } from "./mission";

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
 * - De Director mag alleen kiezen tussen DISPATCH_ROLE (opnieuw de
 *   builder-rol inzetten) en, alleen als er al minstens één afgeronde
 *   toewijzing is, COMPLETE_MISSION. De andere besluittypes (bv. een
 *   goedkeuring of vraag aan de eigenaar vragen) zijn uitgezet omdat er nog
 *   geen scherm is om daar iets mee te doen — die zouden een missie muurvast
 *   laten lopen.
 * - Bij COMPLETE_MISSION beoordeelt de Director zelf (niet een aparte
 *   QA-rol — die bestaat nog niet) of de succescriteria gehaald zijn. Dat is
 *   een bewuste, eerlijke beperking van deze eerste versie.
 *
 * Vanaf hier gebruikt de Director ook goedgekeurde kennis uit het Second
 * Brain (dezelfde kennis die je via de Kennis-pagina keurt) als achtergrond
 * bij zijn beslissing — zie gatherRelevantKnowledge. Dit is bewust beperkt
 * tot uitsluitend goedgekeurde kennis (retrieveKnowledgeContext filtert al
 * op status "approved") en wordt nooit boven de missie zelf gesteld: de
 * succescriteria en het doel van de missie blijven leidend.
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

interface DirectorLlmDecision {
  decisionType: DirectorDecisionType;
  reason: string;
  nextAction: string;
  successCriteria: string[];
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
    .map((criterion) => `- (${criterion.status}) ${criterion.description}`)
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
    ? '"DISPATCH_ROLE" of "COMPLETE_MISSION"'
    : '"DISPATCH_ROLE" (COMPLETE_MISSION is nu niet toegestaan: er is nog geen afgeronde toewijzing)';

  const userPrompt = [
    `Missie: "${mission.title}"`,
    `Doel: ${mission.objective}`,
    "",
    "Succescriteria:",
    criteriaLines,
    "",
    "Eerdere toewijzingen:",
    assignmentLines,
    "",
    "Relevante goedgekeurde kennis uit het Second Brain (uitsluitend ter achtergrond — gebruik dit nooit om de succescriteria hierboven te vervangen of aan te vullen, en verzin geen kennis die hier niet expliciet staat):",
    buildKnowledgeContextBlock(knowledge),
    "",
    'De enige beschikbare rol om taken aan toe te wijzen is "builder".',
    `Kies één decisionType uit: ${allowedTypes}.`,
    "",
    "Antwoord exact in dit JSON-formaat, niets anders:",
    "{",
    '  "decisionType": "DISPATCH_ROLE" | "COMPLETE_MISSION",',
    '  "reason": "korte onderbouwing van je keuze",',
    '  "nextAction": "concrete opdracht voor de builder-rol (alleen relevant bij DISPATCH_ROLE)",',
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
  };
}

/**
 * Laat de Director één beslissing nemen over een ACTIVE mission en past die
 * direct toe. Bij COMPLETE_MISSION worden eerst alle succescriteria als
 * PASSED gemarkeerd (self-assessment door de Director — zie module-uitleg
 * hierboven) zodat de engine de missie daadwerkelijk mag afronden.
 */
export async function runDirectorStep({
  engine,
  missionId,
  actor = { type: "director", id: "director" },
}: RunDirectorStepInput): Promise<RunDirectorStepResult> {
  let mission = await engine.getMission(missionId);

  if (!mission) {
    throw new Error(`Mission ${missionId} bestaat niet.`);
  }

  if (mission.status !== "ACTIVE") {
    throw new Error(
      `De Director kan alleen een beslissing nemen wanneer de mission ACTIEF is (huidige status: ${mission.status}).`,
    );
  }

  const allowComplete =
    mission.assignments.some((assignment) => assignment.status === "COMPLETED") &&
    mission.activeAssignmentIds.length === 0;

  const usedKnowledge = await gatherRelevantKnowledge(mission);
  const llmDecision = await decideNextStep(mission, allowComplete, usedKnowledge);
  const now = new Date().toISOString();

  const decision: DirectorDecision = {
    decisionId: randomUUID(),
    missionId: mission.missionId,
    decisionType: llmDecision.decisionType,
    reason: llmDecision.reason,
    nextAction: llmDecision.nextAction,
    assignedRole: llmDecision.decisionType === "DISPATCH_ROLE" ? "builder" : undefined,
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

  if (decision.decisionType === "COMPLETE_MISSION") {
    const lastCompleted = [...mission.assignments]
      .reverse()
      .find((assignment) => assignment.status === "COMPLETED");
    const evidenceRefs = lastCompleted?.resultId ? [lastCompleted.resultId] : [];

    for (const criterion of mission.successCriteria) {
      if (criterion.status === "PASSED") continue;

      mission = await engine.evaluateCriterion({
        actor,
        correlationId: decision.decisionId,
        issuedAt: new Date().toISOString(),
        commandVersion: "1.0",
        commandId: randomUUID(),
        commandType: "EvaluateMissionCriterion",
        targetId: mission.missionId,
        expectedTargetVersion: mission.version,
        payload: {
          criterionId: criterion.criterionId,
          passed: true,
          evidenceRefs,
        },
      });
    }
  }

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
