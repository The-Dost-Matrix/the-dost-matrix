import type { EntityId, IsoDateTime, JsonValue } from "./primitives";
import { assertIsoDateTime, assertNonEmptyString, isOneOf } from "./primitives";

export const ROLE_RESULT_STATUSES = [
  "COMPLETED",
  "FAILED",
  "WAITING_FOR_INPUT",
  "CANCELLED",
] as const;

export type RoleResultStatus = (typeof ROLE_RESULT_STATUSES)[number];

export interface UsageRecord {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  currency?: string;
  durationMs?: number;
}

export interface RoleResult {
  resultId: EntityId;
  assignmentId: EntityId;
  missionId: EntityId;
  status: RoleResultStatus;
  summary: string;
  deliverables: JsonValue[];
  evidence: EntityId[];
  assumptions: string[];
  uncertainties: string[];
  risks: string[];
  recommendations: string[];
  successCriteriaResults: Record<string, boolean>;
  artifactRefs: EntityId[];
  usage: UsageRecord;
  createdAt: IsoDateTime;
}

export function assertRoleResult(
  result: RoleResult,
): asserts result is RoleResult {
  assertNonEmptyString(result.resultId, "resultId");
  assertNonEmptyString(result.assignmentId, "assignmentId");
  assertNonEmptyString(result.missionId, "missionId");
  assertNonEmptyString(result.summary, "summary");
  assertIsoDateTime(result.createdAt, "createdAt");

  if (!isOneOf(result.status, ROLE_RESULT_STATUSES)) {
    throw new Error(`Onbekende rolresultaatstatus: ${result.status}`);
  }
}
