import type { EntityId, IsoDateTime, JsonValue } from "./primitives";
import {
  assertIsoDateTime,
  assertNonEmptyString,
  assertNonNegativeNumber,
} from "./primitives";

export interface AssignmentBudget {
  maximumCost: number;
  currency: string;
  maximumDurationMs: number;
  maximumModelTokens?: number;
}

export interface RoleAssignment {
  assignmentId: EntityId;
  missionId: EntityId;
  roleId: EntityId;
  roleVersion: string;
  objective: string;
  instructions: string[];
  inputRefs: EntityId[];
  contextPackageRef: EntityId;
  constraints: Record<string, JsonValue>;
  successCriteria: string[];
  allowedTools: string[];
  budget: AssignmentBudget;
  deadline?: IsoDateTime;
  modelRequirements: Record<string, JsonValue>;
  approvalRules: string[];
  createdAt: IsoDateTime;
}

export function assertRoleAssignment(
  assignment: RoleAssignment,
): asserts assignment is RoleAssignment {
  assertNonEmptyString(assignment.assignmentId, "assignmentId");
  assertNonEmptyString(assignment.missionId, "missionId");
  assertNonEmptyString(assignment.roleId, "roleId");
  assertNonEmptyString(assignment.roleVersion, "roleVersion");
  assertNonEmptyString(assignment.objective, "objective");
  assertNonEmptyString(assignment.contextPackageRef, "contextPackageRef");
  assertNonNegativeNumber(assignment.budget.maximumCost, "budget.maximumCost");
  assertNonNegativeNumber(
    assignment.budget.maximumDurationMs,
    "budget.maximumDurationMs",
  );
  assertNonEmptyString(assignment.budget.currency, "budget.currency");
  assertIsoDateTime(assignment.createdAt, "createdAt");

  if (assignment.deadline) {
    assertIsoDateTime(assignment.deadline, "deadline");
  }

  if (assignment.successCriteria.length === 0) {
    throw new Error("Een roltoewijzing moet minimaal één succescriterium hebben.");
  }
}
