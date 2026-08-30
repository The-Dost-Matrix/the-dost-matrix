import type { EntityId, IsoDateTime } from "@/core/contracts/v2";
import {
  assertIsoDateTime,
  assertNonEmptyString,
  assertNonNegativeNumber,
  isOneOf,
} from "@/core/contracts/v2";

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
export type MissionApprovalState =
  | "NOT_REQUIRED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED";
export type CriterionStatus = "PENDING" | "PASSED" | "FAILED";
export type AssignmentStatus =
  | "ACTIVE"
  | "COMPLETED"
  | "FAILED"
  | "WAITING_FOR_INPUT"
  | "CANCELLED";

export interface MissionBudget {
  maximumCost: number;
  currency: string;
}

export interface MissionCriterion {
  criterionId: EntityId;
  description: string;
  status: CriterionStatus;
  evidenceRefs: EntityId[];
  evaluatedAt?: IsoDateTime;
  /**
   * Toelichting van de laatste beoordeling (meestal van de qa-rol), bv.
   * "geen CSS zichtbaar in de diff". Bewaard zodat de Director dit bij een
   * volgende beslissing kan meenemen — zonder dit veld zag de Director bij
   * een FAILED-criterium alleen de kale omschrijving terug, niet WAAROM het
   * niet gehaald was, waardoor een nieuwe poging even ongericht kon zijn als
   * de vorige.
   */
  lastEvaluationNote?: string;
}

export interface MissionAssignmentRecord {
  assignmentId: EntityId;
  decisionId: EntityId;
  roleId: EntityId;
  status: AssignmentStatus;
  objective: string;
  successCriteria: string[];
  resultId?: EntityId;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface PendingOwnerInput {
  requestId: EntityId;
  question: string;
  requestedAt: IsoDateTime;
}

export interface PendingApproval {
  approvalId: EntityId;
  action: string;
  reason: string;
  requestedAt: IsoDateTime;
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
  successCriteria: MissionCriterion[];
  constraints: string[];
  currentDecisionId?: EntityId;
  assignments: MissionAssignmentRecord[];
  activeAssignmentIds: EntityId[];
  ownerApprovalState: MissionApprovalState;
  pendingOwnerInput?: PendingOwnerInput;
  pendingApproval?: PendingApproval;
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
  if (mission.goalRefs.length === 0) {
    throw new Error("Een mission moet minimaal één goal refereren.");
  }
  if (mission.successCriteria.length === 0) {
    throw new Error("Een mission moet minimaal één succescriterium hebben.");
  }
  if (mission.spentCost > mission.budget.maximumCost) {
    throw new Error("Mission budget is overschreden.");
  }

  const uniqueActiveIds = new Set(mission.activeAssignmentIds);
  if (uniqueActiveIds.size !== mission.activeAssignmentIds.length) {
    throw new Error("activeAssignmentIds bevat duplicaten.");
  }

  for (const assignmentId of mission.activeAssignmentIds) {
    const assignment = mission.assignments.find(
      (candidate) => candidate.assignmentId === assignmentId,
    );
    if (!assignment || assignment.status !== "ACTIVE") {
      throw new Error(`Actieve assignment ${assignmentId} is niet geldig.`);
    }
  }

  if (mission.status === "WAITING_FOR_ROLE" && mission.activeAssignmentIds.length === 0) {
    throw new Error("WAITING_FOR_ROLE vereist minimaal één actieve assignment.");
  }
  if (mission.status === "WAITING_FOR_OWNER" && !mission.pendingOwnerInput) {
    throw new Error("WAITING_FOR_OWNER vereist een open inputverzoek.");
  }
  if (mission.status === "WAITING_FOR_APPROVAL" && !mission.pendingApproval) {
    throw new Error("WAITING_FOR_APPROVAL vereist een open goedkeuringsverzoek.");
  }
  if (mission.status === "COMPLETED") {
    if (mission.activeAssignmentIds.length > 0) {
      throw new Error("Een voltooide mission mag geen actieve assignments hebben.");
    }
    if (mission.successCriteria.some((criterion) => criterion.status !== "PASSED")) {
      throw new Error("Alle succescriteria moeten PASSED zijn voor voltooiing.");
    }
    if (!mission.completedAt) {
      throw new Error("completedAt is verplicht voor een voltooide mission.");
    }
  }
}

export function hasPassedAllCriteria(mission: MissionV2): boolean {
  return mission.successCriteria.every((criterion) => criterion.status === "PASSED");
}
