import type { EntityId, IsoDateTime } from "./primitives";
import { assertIsoDateTime, assertNonEmptyString, isOneOf } from "./primitives";

export const APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const RISK_CLASSES = ["R0", "R1", "R2", "R3", "R4"] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

export interface ApprovalRequest {
  approvalId: EntityId;
  missionId: EntityId;
  action: string;
  reason: string;
  riskClass: RiskClass;
  estimatedCost?: number;
  currency?: string;
  dataExposure: string[];
  expiresAt?: IsoDateTime;
  status: ApprovalStatus;
  requestedAt: IsoDateTime;
  resolvedAt?: IsoDateTime;
}

export function assertApprovalRequest(
  request: ApprovalRequest,
): asserts request is ApprovalRequest {
  assertNonEmptyString(request.approvalId, "approvalId");
  assertNonEmptyString(request.missionId, "missionId");
  assertNonEmptyString(request.action, "action");
  assertNonEmptyString(request.reason, "reason");
  assertIsoDateTime(request.requestedAt, "requestedAt");

  if (!isOneOf(request.riskClass, RISK_CLASSES)) {
    throw new Error(`Onbekende risicoklasse: ${request.riskClass}`);
  }

  if (!isOneOf(request.status, APPROVAL_STATUSES)) {
    throw new Error(`Onbekende goedkeuringsstatus: ${request.status}`);
  }

  if (request.expiresAt) {
    assertIsoDateTime(request.expiresAt, "expiresAt");
  }

  if (request.resolvedAt) {
    assertIsoDateTime(request.resolvedAt, "resolvedAt");
  }
}
