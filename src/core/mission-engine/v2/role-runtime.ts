import { randomUUID } from "node:crypto";

import type { ActorRef, JsonValue, RoleResult } from "@/core/contracts/v2";
import { getChatProvider } from "@/core/llm/model-router";

import type { MissionEngine } from "./engine";
import type { MissionV2 } from "./mission";

/**
 * Role Runtime v0 voor Mission Engine V2.
 *
 * Dit is bewust een kleine, eerlijke eerste stap: gegeven een mission met
 * een actieve assignment (status WAITING_FOR_ROLE), roept dit een LLM aan
 * om de opdracht van die assignment daadwerkelijk uit te voeren, en meldt
 * het resultaat terug aan de engine via `recordRoleResult`.
 *
 * Wat dit NIET is (nog): een autonome Director die zelf beslist wélke rol
 * wanneer moet worden ingezet (dat gebeurt via `applyDirectorDecision`,
 * vooralsnog handmatig/extern getriggerd — zie de "dispatch"-actie in de
 * API-route). Ook wordt hier geen automatisch oordeel geveld over de
 * succescriteria: `successCriteriaResults` komt terug als een leeg object,
 * zodat er geen vals "voltooid" wordt gesuggereerd. Een echte QA-rol die dat
 * oordeel velt is vervolgwerk.
 */

export interface ExecuteRoleAssignmentInput {
  engine: MissionEngine;
  missionId: string;
  assignmentId: string;
  actor?: ActorRef;
}

export interface ExecuteRoleAssignmentResult {
  mission: MissionV2;
  roleOutput: string;
}

function buildSystemPrompt(mission: MissionV2): string {
  return [
    "Je bent een uitvoerende rol binnen The Dost Matrix, een persoonlijk AI-besturingssysteem.",
    `Je werkt aan de missie "${mission.title}" (doel: ${mission.objective}).`,
    "Voer de opdracht van je toewijzing zo concreet en bruikbaar mogelijk uit.",
    "Antwoord in het Nederlands, duidelijk en zonder overbodige inleidingen.",
  ].join(" ");
}

function buildUserPrompt(
  mission: MissionV2,
  assignment: MissionV2["assignments"][number],
): string {
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

/**
 * Voert de actieve assignment van een mission uit via de geconfigureerde
 * LLM-provider en verwerkt het resultaat in de Mission Engine.
 *
 * Verwacht dat de mission status WAITING_FOR_ROLE heeft en dat de opgegeven
 * assignmentId bij een actieve (status ACTIVE) assignment hoort — anders
 * gooit deze functie een duidelijke foutmelding.
 */
export async function executeRoleAssignment({
  engine,
  missionId,
  assignmentId,
  actor = { type: "role", id: "role-runtime" },
}: ExecuteRoleAssignmentInput): Promise<ExecuteRoleAssignmentResult> {
  const mission = await engine.getMission(missionId);

  if (!mission) {
    throw new Error(`Mission ${missionId} bestaat niet.`);
  }

  const assignment = mission.assignments.find(
    (candidate) => candidate.assignmentId === assignmentId,
  );

  if (!assignment || assignment.status !== "ACTIVE") {
    throw new Error(
      `Assignment ${assignmentId} is niet actief op mission ${missionId}.`,
    );
  }

  const provider = getChatProvider();
  const startedAt = Date.now();
  const completion = await provider.chatCompletion(buildSystemPrompt(mission), [
    { role: "user", content: buildUserPrompt(mission, assignment) },
  ]);
  const durationMs = Date.now() - startedAt;

  const now = new Date().toISOString();
  const result: RoleResult = {
    resultId: randomUUID(),
    assignmentId,
    missionId,
    status: "COMPLETED",
    summary: completion.content.slice(0, 500),
    deliverables: [completion.content],
    evidence: [],
    assumptions: [],
    uncertainties: [],
    risks: [],
    recommendations: [],
    // Bewust leeg: dit is een uitvoerende rol, geen QA-oordeel. Zie de
    // module-documentatie hierboven.
    successCriteriaResults: {},
    artifactRefs: [],
    usage: {
      provider: provider.id,
      model: completion.model,
      durationMs,
    },
    createdAt: now,
  };

  const updatedMission = await engine.recordRoleResult({
    commandId: randomUUID(),
    commandType: "RecordRoleResult",
    commandVersion: "1.0",
    targetId: missionId,
    expectedTargetVersion: mission.version,
    actor,
    correlationId: randomUUID(),
    issuedAt: now,
    payload: { result: result as unknown as JsonValue },
  });

  return { mission: updatedMission, roleOutput: completion.content };
}
