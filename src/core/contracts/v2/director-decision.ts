import type { EntityId, IsoDateTime, JsonValue } from "./primitives";
import { assertIsoDateTime, assertNonEmptyString, isOneOf } from "./primitives";

export const DIRECTOR_DECISION_TYPES = [
  "DISPATCH_ROLE",
  "REQUEST_OWNER_INPUT",
  "REQUEST_APPROVAL",
  "REPLAN",
  "PAUSE_MISSION",
  "COMPLETE_MISSION",
  "CANCEL_MISSION",
  "STORE_KNOWLEDGE",
  "EVALUATE_RESULT",
] as const;

export type DirectorDecisionType = (typeof DIRECTOR_DECISION_TYPES)[number];

export interface DirectorDecision {
  decisionId: EntityId;
  missionId: EntityId;
  decisionType: DirectorDecisionType;
  reason: string;
  nextAction: string;
  assignedRole?: string;
  requiredCapabilities: string[];
  contextRequirements: string[];
  modelConstraints: Record<string, JsonValue>;
  approvalRequirement: "none" | "owner" | "additional_review";
  successCriteria: string[];
  failureStrategy: string;
  createdAt: IsoDateTime;
}

export function assertDirectorDecision(
  decision: DirectorDecision,
): asserts decision is DirectorDecision {
  assertNonEmptyString(decision.decisionId, "decisionId");
  assertNonEmptyString(decision.missionId, "missionId");

  if (!isOneOf(decision.decisionType, DIRECTOR_DECISION_TYPES)) {
    throw new Error(`Onbekend Director-besluittype: ${decision.decisionType}`);
  }

  assertNonEmptyString(decision.reason, "reason");
  assertNonEmptyString(decision.nextAction, "nextAction");
  assertNonEmptyString(decision.failureStrategy, "failureStrategy");
  assertIsoDateTime(decision.createdAt, "createdAt");

  if (
    decision.decisionType === "DISPATCH_ROLE" &&
    !decision.assignedRole?.trim()
  ) {
    throw new Error("assignedRole is verplicht voor DISPATCH_ROLE.");
  }

  if (decision.successCriteria.length === 0) {
    throw new Error("Een Director-besluit moet minimaal één succescriterium hebben.");
  }
}
