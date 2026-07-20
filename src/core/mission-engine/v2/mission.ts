import type { EntityId, IsoDateTime } from "@/core/contracts/v2";
import { assertIsoDateTime, assertNonEmptyString, assertNonNegativeNumber, isOneOf } from "@/core/contracts/v2";

export const MISSION_STATUSES = [
  "DRAFT",
  "READY",
  "ACTIVE",
  "WAITING_FOR_ROLE",
  "WAITING_FOR_OWNER",
  "WAITING_FOR_APPROVAL",
  "REPLANNING",
  "PAUSED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type MissionStatus = (typeof MISSION_STATUSES)[number];
export type MissionRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface MissionBudget {
  maximumCost: number;
  currency: string;
}

export interface MissionV2 {
  missionId: EntityId;
  ownerId: EntityId;
  projectId: EntityId;
  goalRefs: EntityId[];
  title: string;
  objective: string;
  status: MissionStatus;
  priority: number;
  riskLevel: MissionRiskLevel;
  budget: MissionBudget;
  spentCost: number;
  successCriteria: string[];
  constraints: string[];
  currentDecisionId?: EntityId;
  activeAssignmentIds: EntityId[];
  ownerApprovalState: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  failureReason?: string;
  cancellationReason?: string;
}

export function assertMission(mission: MissionV2): asserts mission is MissionV2 {
  assertNonEmptyString(mission.missionId, "missionId");
  assertNonEmptyString(mission.ownerId, "ownerId");
  assertNonEmptyString(mission.projectId, "projectId");
  assertNonEmptyString(mission.title, "title");
  assertNonEmptyString(mission.objective, "objective");
  assertNonEmptyString(mission.budget.currency, "budget.currency");
  assertNonNegativeNumber(mission.budget.maximumCost, "budget.maximumCost");
  assertNonNegativeNumber(mission.spentCost, "spentCost");
  assertIsoDateTime(mission.createdAt, "createdAt");
  assertIsoDateTime(mission.updatedAt, "updatedAt");

  if (!isOneOf(mission.status, MISSION_STATUSES)) {
    throw new Error(`Onbekende mission status: ${mission.status}`);
  }
  if (!Number.isInteger(mission.priority) || mission.priority < 0) {
    throw new Error("priority moet een niet-negatief geheel getal zijn.");
  }
  if (!Number.isInteger(mission.version) || mission.version < 1) {
    throw new Error("version moet minimaal 1 zijn.");
  }
  if (mission.successCriteria.length === 0) {
    throw new Error("Een mission moet minimaal één succescriterium hebben.");
  }
  if (mission.spentCost > mission.budget.maximumCost) {
    throw new Error("Mission budget is overschreden.");
  }
}
