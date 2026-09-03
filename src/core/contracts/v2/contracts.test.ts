import { expect, test } from "vitest";

import {
  assertApprovalRequest,
  assertCommandEnvelope,
  assertDirectorDecision,
  assertDomainEventEnvelope,
  assertRoleAssignment,
  assertRoleResult,
  type ApprovalRequest,
  type CommandEnvelope,
  type DirectorDecision,
  type DomainEventEnvelope,
  type RoleAssignment,
  type RoleResult,
} from "./index";

const now = "2026-07-20T18:00:00.000Z";

test("accepts a valid command envelope", () => {
  const command: CommandEnvelope = {
    commandId: "cmd-1",
    commandType: "CreateMission",
    commandVersion: "2.0",
    targetId: "mission-1",
    expectedTargetVersion: 1,
    actor: { type: "owner", id: "owner-1" },
    correlationId: "correlation-1",
    issuedAt: now,
    payload: { objective: "Bouw Canonical Contracts" },
  };

  expect(() => assertCommandEnvelope(command)).not.toThrow();
});

test("rejects a dispatch decision without an assigned role", () => {
  const decision: DirectorDecision = {
    decisionId: "decision-1",
    missionId: "mission-1",
    decisionType: "DISPATCH_ROLE",
    reason: "Specialistische uitvoering is nodig.",
    nextAction: "Laat de Builder implementeren.",
    requiredCapabilities: ["typescript"],
    contextRequirements: [],
    modelConstraints: {},
    approvalRequirement: "none",
    successCriteria: ["Typecheck slaagt"],
    failureStrategy: "Vraag een herziening aan.",
    createdAt: now,
  };

  expect(() => assertDirectorDecision(decision)).toThrow(
    /assignedRole is verplicht/,
  );
});

test("accepts a bounded role assignment", () => {
  const assignment: RoleAssignment = {
    assignmentId: "assignment-1",
    missionId: "mission-1",
    roleId: "builder",
    roleVersion: "2.0",
    objective: "Implementeer contracten.",
    instructions: ["Werk volgens de architectuur."],
    inputRefs: [],
    contextPackageRef: "context-1",
    constraints: {},
    successCriteria: ["Lint slaagt", "Build slaagt"],
    allowedTools: ["filesystem.write"],
    budget: {
      maximumCost: 5,
      currency: "EUR",
      maximumDurationMs: 3_600_000,
    },
    modelRequirements: {},
    approvalRules: [],
    createdAt: now,
  };

  expect(() => assertRoleAssignment(assignment)).not.toThrow();
});

test("accepts a completed structured role result", () => {
  const result: RoleResult = {
    resultId: "result-1",
    assignmentId: "assignment-1",
    missionId: "mission-1",
    status: "COMPLETED",
    summary: "Contracten geïmplementeerd.",
    deliverables: [{ path: "src/core/contracts/v2" }],
    evidence: [],
    assumptions: [],
    uncertainties: [],
    risks: [],
    recommendations: [],
    successCriteriaResults: { "Lint slaagt": true },
    artifactRefs: [],
    usage: { durationMs: 1000 },
    createdAt: now,
  };

  expect(() => assertRoleResult(result)).not.toThrow();
});

test("accepts an owner approval request", () => {
  const approval: ApprovalRequest = {
    approvalId: "approval-1",
    missionId: "mission-1",
    action: "Deploy production",
    reason: "Productiewijziging met externe impact.",
    riskClass: "R3",
    dataExposure: [],
    status: "PENDING",
    requestedAt: now,
  };

  expect(() => assertApprovalRequest(approval)).not.toThrow();
});

test("accepts a versioned domain event", () => {
  const event: DomainEventEnvelope = {
    eventId: "event-1",
    eventType: "mission.created",
    eventVersion: "2.0",
    aggregateType: "mission",
    aggregateId: "mission-1",
    aggregateVersion: 1,
    correlationId: "correlation-1",
    actor: { type: "owner", id: "owner-1" },
    occurredAt: now,
    recordedAt: now,
    payload: { objective: "Canonical Contracts" },
    metadata: {},
  };

  expect(() => assertDomainEventEnvelope(event)).not.toThrow();
});
