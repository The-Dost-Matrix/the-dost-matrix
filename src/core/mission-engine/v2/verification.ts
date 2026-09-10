import type {
  CommandEnvelope,
  DirectorDecision,
  JsonValue,
  RoleResult,
} from "@/core/contracts/v2";
import { MissionEngine } from "./engine";
import { InMemoryMissionEngineStore } from "./store";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export async function verifyMissionEngineV2(): Promise<void> {
  let sequence = 0;
  const store = new InMemoryMissionEngineStore();
  const engine = new MissionEngine(
    store,
    { now: () => "2026-07-20T20:00:00.000Z" },
    { nextId: (prefix) => `${prefix}_${++sequence}` },
  );
  const common = {
    actor: { type: "owner", id: "owner_1" } as const,
    correlationId: "correlation_1",
    issuedAt: "2026-07-20T20:00:00.000Z",
    commandVersion: "1.0" as const,
  };

  const mission = await engine.create({
    ...common,
    commandId: "command_create",
    commandType: "CreateMission",
    targetId: "mission_1",
    expectedTargetVersion: 1,
    payload: {
      ownerId: "owner_1",
      projectId: "project_1",
      goalRefs: ["goal_1"],
      title: "Mission Engine",
      objective: "Bouw de Mission Engine",
      priority: 1,
      riskLevel: "LOW",
      budget: { maximumCost: 100, currency: "EUR" },
      successCriteria: ["Typecheck slaagt"],
      constraints: [],
    },
  });
  expect(mission.status === "DRAFT", "Mission start niet in DRAFT.");

  const ready = await engine.markReady(emptyCommand(common, "command_ready", "MarkMissionReady", 1));
  const active = await engine.activate(emptyCommand(common, "command_activate", "ActivateMission", 2));
  expect(ready.status === "READY" && active.status === "ACTIVE", "Activatiepad faalt.");

  const decision: DirectorDecision = {
    decisionId: "decision_1",
    missionId: "mission_1",
    decisionType: "DISPATCH_ROLE",
    reason: "Implementatie vereist",
    nextAction: "Bouw de runtime",
    assignedRole: "builder",
    requiredCapabilities: ["typescript"],
    contextRequirements: [],
    modelConstraints: {},
    approvalRequirement: "none",
    successCriteria: ["Code compileert"],
    failureStrategy: "Replan",
    createdAt: common.issuedAt,
  };
  const waiting = await engine.applyDirectorDecision({
    ...common,
    commandId: "command_decision",
    commandType: "ApplyDirectorDecision",
    targetId: "mission_1",
    expectedTargetVersion: 3,
    payload: { decision: decision as unknown as JsonValue },
  });
  expect(waiting.status === "WAITING_FOR_ROLE", "Dispatch zet status niet goed.");
  expect(waiting.activeAssignmentIds.length === 1, "Dispatch registreert assignment niet.");

  const assignmentId = waiting.activeAssignmentIds[0];
  const result: RoleResult = {
    resultId: "result_1",
    assignmentId,
    missionId: "mission_1",
    status: "COMPLETED",
    summary: "Gereed",
    deliverables: [],
    evidence: [],
    assumptions: [],
    uncertainties: [],
    risks: [],
    recommendations: [],
    successCriteriaResults: { "Code compileert": true },
    artifactRefs: [],
    usage: { cost: 2, currency: "EUR" },
    createdAt: common.issuedAt,
  };
  const afterResult = await engine.recordRoleResult({
    ...common,
    commandId: "command_result",
    commandType: "RecordRoleResult",
    targetId: "mission_1",
    expectedTargetVersion: 4,
    payload: { result: result as unknown as JsonValue },
  });
  expect(afterResult.status === "ACTIVE", "Voltooid resultaat keert niet terug naar ACTIVE.");
  expect(afterResult.activeAssignmentIds.length === 0, "Assignment blijft onterecht actief.");

  const evaluated = await engine.evaluateCriterion({
    ...common,
    commandId: "command_evaluate",
    commandType: "EvaluateMissionCriterion",
    targetId: "mission_1",
    expectedTargetVersion: 5,
    payload: {
      criterionId: afterResult.successCriteria[0].criterionId,
      outcome: "PASSED",
      evidenceRefs: ["result_1"],
      note: null,
    },
  });
  expect(evaluated.successCriteria[0].status === "PASSED", "Criterium wordt niet behaald.");

  const completeDecision: DirectorDecision = {
    ...decision,
    decisionId: "decision_complete",
    decisionType: "COMPLETE_MISSION",
    assignedRole: undefined,
    reason: "Alle criteria behaald",
    nextAction: "Voltooi mission",
  };
  const completed = await engine.applyDirectorDecision({
    ...common,
    commandId: "command_complete",
    commandType: "ApplyDirectorDecision",
    targetId: "mission_1",
    expectedTargetVersion: 6,
    payload: { decision: completeDecision as unknown as JsonValue },
  });
  expect(completed.status === "COMPLETED", "Mission voltooit niet.");
  expect((await store.readOutbox()).length === 7, "Outbox bevat niet elk event.");
}

function emptyCommand(
  common: {
    actor: { type: "owner"; id: string };
    correlationId: string;
    issuedAt: string;
    commandVersion: "1.0";
  },
  commandId: string,
  commandType: string,
  expectedTargetVersion: number,
): CommandEnvelope<Record<string, never>> {
  return {
    ...common,
    commandId,
    commandType,
    targetId: "mission_1",
    expectedTargetVersion,
    payload: {},
  };
}

const _jsonCompatibility: JsonValue = {};
void _jsonCompatibility;
