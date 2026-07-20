import type { EntityId, IsoDateTime, JsonValue } from "./primitives";
import {
  assertIsoDateTime,
  assertNonEmptyString,
  assertNonNegativeNumber,
} from "./primitives";

export interface ContextItem {
  knowledgeId: EntityId;
  content: JsonValue;
  sourceRefs: EntityId[];
  confidence?: number;
}

export interface ContextPackage {
  contextPackageId: EntityId;
  missionId: EntityId;
  assignmentId?: EntityId;
  objective: string;
  ownerPreferences: ContextItem[];
  activeDecisions: ContextItem[];
  facts: ContextItem[];
  principles: ContextItem[];
  experiences: ContextItem[];
  sourceFragments: ContextItem[];
  knownUncertainties: string[];
  excludedDataSummary: string[];
  tokenBudget: number;
  createdAt: IsoDateTime;
}

export function assertContextPackage(
  context: ContextPackage,
): asserts context is ContextPackage {
  assertNonEmptyString(context.contextPackageId, "contextPackageId");
  assertNonEmptyString(context.missionId, "missionId");
  assertNonEmptyString(context.objective, "objective");
  assertNonNegativeNumber(context.tokenBudget, "tokenBudget");
  assertIsoDateTime(context.createdAt, "createdAt");
}
