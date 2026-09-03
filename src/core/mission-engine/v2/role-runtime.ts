import { randomUUID } from "node:crypto";

import type { ActorRef, JsonValue, RoleResult } from "@/core/contracts/v2";
import { getChatProvider } from "@/core/llm/model-router";
import { estimateCost } from "@/core/llm/pricing";

import { executeBuilderAssignment } from "./builder-runtime";
import type { MissionEngine } from "./engine";
import type { MissionV2 } from "./mission";
import { executeQaAssignment, type CriterionVerdict } from "./qa-runtime";

/**
 * Role Runtime v0 voor Mission Engine V2.
 *
 * Gegeven een mission met een actieve assignment (status WAITING_FOR_ROLE),
 * voert dit de opdracht van die assignment daadwerkelijk uit en meldt het
 * resultaat terug aan de engine via `recordRoleResult`.
 *
 * Sinds de koppeling met GitHub wordt hier per rol bepaald HOE een
 * toewijzing wordt uitgevoerd:
 * - "builder" (zie builder-runtime.ts) past echt bestanden aan via een
 *   GitHub pull request, in plaats van alleen een tekstueel plan te geven.
 *   Zelf velt de Builder geen oordeel over de succescriteria —
 *   `successCriteriaResults` komt daar altijd leeg terug.
 * - "qa" (zie qa-runtime.ts) beoordeelt een pull request van de Builder
 *   tegen de succescriteria van de missie, en het resultaat daarvan wordt
 *   hieronder direct toegepast via `engine.evaluateCriterion` — dat is de
 *   enige plek in Mission Engine V2 waar succescriteria nog op PASSED/FAILED
 *   gezet worden (zie ook de opruiming van de vroegere self-assessment in
 *   director-runtime.ts).
 * - Andere/toekomstige rollen vallen terug op de oorspronkelijke, simpele
 *   tekst-only uitvoering hieronder totdat zij hun eigen, passende
 *   uitvoering krijgen.
 *
 * Wat dit NIET is (nog): een autonome Director die zelf beslist wélke rol
 * wanneer moet worden ingezet (dat gebeurt via `applyDirectorDecision`,
 * vooralsnog handmatig/extern getriggerd — zie de "dispatch"-actie in de
 * API-route).
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

  let result: RoleResult;
  let roleOutput: string;
  let criteriaVerdicts: CriterionVerdict[] = [];

  if (assignment.roleId === "builder") {
    const builderOutcome = await executeBuilderAssignment({ mission, assignment });
    result = builderOutcome.result;
    roleOutput = builderOutcome.roleOutput;
  } else if (assignment.roleId === "qa") {
    const qaOutcome = await executeQaAssignment({ mission, assignment });
    result = qaOutcome.result;
    roleOutput = qaOutcome.roleOutput;
    criteriaVerdicts = qaOutcome.criteriaVerdicts;
  } else {
    const provider = getChatProvider();
    const startedAt = Date.now();
    const completion = await provider.chatCompletion(buildSystemPrompt(mission), [
      { role: "user", content: buildUserPrompt(mission, assignment) },
    ]);
    const durationMs = Date.now() - startedAt;

    result = {
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
        inputTokens: completion.usage?.inputTokens,
        outputTokens: completion.usage?.outputTokens,
        cost: completion.usage ? estimateCost(completion.model, completion.usage) : undefined,
        currency: completion.usage ? "USD" : undefined,
      },
      createdAt: new Date().toISOString(),
    };
    roleOutput = completion.content;
  }

  let updatedMission = await engine.recordRoleResult({
    commandId: randomUUID(),
    commandType: "RecordRoleResult",
    commandVersion: "1.0",
    targetId: missionId,
    expectedTargetVersion: mission.version,
    actor,
    correlationId: randomUUID(),
    issuedAt: new Date().toISOString(),
    payload: { result: result as unknown as JsonValue },
  });

  // Alleen de QA-rol levert verdicts op (zie qa-runtime.ts). Dit is de enige
  // plek in Mission Engine V2 waar succescriteria nog worden geëvalueerd —
  // de Director zelf doet dit niet meer (zie director-runtime.ts).
  for (const verdict of criteriaVerdicts) {
    updatedMission = await engine.evaluateCriterion({
      commandId: randomUUID(),
      commandType: "EvaluateMissionCriterion",
      commandVersion: "1.0",
      targetId: missionId,
      expectedTargetVersion: updatedMission.version,
      actor,
      correlationId: randomUUID(),
      issuedAt: new Date().toISOString(),
      payload: {
        criterionId: verdict.criterionId,
        passed: verdict.passed,
        evidenceRefs: [result.resultId],
        note: verdict.reason,
      },
    });
  }

  return { mission: updatedMission, roleOutput };
}
