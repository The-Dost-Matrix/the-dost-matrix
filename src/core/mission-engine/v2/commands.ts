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
  /**
   * Stap 12b: wanneer het openstaande verzoek over een specifiek
   * succescriterium ging (PendingOwnerInput.relatedCriterionId, zie
   * mission.ts), mag de eigenaar dat criterium hiermee direct op
   * GEHAALD/NIET GEHAALD zetten — zie recordOwnerInput in engine.ts.
   * Optioneel, en zonder effect bij een generiek inputverzoek zonder
   * relatedCriterionId.
   */
  criterionOutcome?: "PASSED" | "FAILED";
}

export interface RecordApprovalPayload extends Record<string, JsonValue> {
  approvalId: EntityId;
  approved: boolean;
  reason: string | null;
}

export interface EvaluateCriterionPayload extends Record<string, JsonValue> {
  criterionId: EntityId;
  /**
   * Was `passed: boolean` — verbreed naar drie waarden in stap 12b, zodat QA
   * ook eerlijk kan zeggen dat ze een criterium niet kon vaststellen (zie
   * CriterionStatus in mission.ts) in plaats van gedwongen te kiezen tussen
   * GEHAALD en een NIET GEHAALD dat een zinloze herstellus zou starten.
   */
  outcome: "PASSED" | "FAILED" | "UNDETERMINED";
  evidenceRefs: EntityId[];
  /** Toelichting bij dit oordeel (bv. van de qa-rol) — zie MissionCriterion.lastEvaluationNote. */
  note: string | null;
}

export interface ReasonPayload extends Record<string, JsonValue> {
  reason: string;
}

export type MissionCommand<TPayload extends JsonValue = JsonValue> = CommandEnvelope<TPayload>;
