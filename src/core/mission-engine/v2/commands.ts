import type {
  CommandEnvelope,
  DirectorDecision,
  EntityId,
  JsonValue,
  RoleResult,
} from "@/core/contracts/v2";
import type { MissionRiskLevel } from "./mission";

export interface CreateMissionPayload extends Record<string, JsonValue> {
  ownerId: EntityId;
  projectId: EntityId;
  goalRefs: EntityId[];
  title: string;
  objective: string;
  priority: number;
  riskLevel: MissionRiskLevel;
  budget: { maximumCost: number; currency: string };
  successCriteria: string[];
  constraints: string[];
}

export interface ApplyDirectorDecisionPayload extends Record<string, JsonValue> {
  decision: JsonValue;
}

export interface RecordRoleResultPayload extends Record<string, JsonValue> {
  result: JsonValue;
}

export interface RecordOwnerInputPayload extends Record<string, JsonValue> {
  requestId: EntityId;
  response: string;
}

export interface RecordApprovalPayload extends Record<string, JsonValue> {
  approvalId: EntityId;
  approved: boolean;
  reason: string | null;
}

export interface EvaluateCriterionPayload extends Record<string, JsonValue> {
  criterionId: EntityId;
  passed: boolean;
  evidenceRefs: EntityId[];
}

export interface ReasonPayload extends Record<string, JsonValue> {
  reason: string;
}

export type MissionCommand<TPayload extends JsonValue = JsonValue> = CommandEnvelope<TPayload>;
