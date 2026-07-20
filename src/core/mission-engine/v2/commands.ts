import type { DirectorDecision, EntityId, IsoDateTime, RoleResult } from "@/core/contracts/v2";
import type { MissionBudget, MissionRiskLevel } from "./mission";

export interface CreateMissionPayload {
  ownerId: EntityId;
  projectId: EntityId;
  goalRefs: EntityId[];
  title: string;
  objective: string;
  priority: number;
  riskLevel: MissionRiskLevel;
  budget: MissionBudget;
  successCriteria: string[];
  constraints: string[];
}

export interface ApplyDirectorDecisionPayload {
  decision: DirectorDecision;
}

export interface RecordRoleResultPayload {
  result: RoleResult;
}

export interface RecordOwnerInputPayload {
  inputRef: EntityId;
}

export interface RecordApprovalPayload {
  approvalId: EntityId;
  approved: boolean;
}

export interface PauseMissionPayload { reason: string; }
export interface ResumeMissionPayload { reason?: string; }
export interface CompleteMissionPayload { completedAt: IsoDateTime; }
export interface FailMissionPayload { reason: string; }
export interface CancelMissionPayload { reason: string; }
