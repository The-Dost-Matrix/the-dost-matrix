import type {
  ActorRef,
  EntityId,
  IsoDateTime,
  JsonValue,
  SchemaVersion,
} from "./primitives";
import {
  assertIsoDateTime,
  assertNonEmptyString,
  assertPositiveInteger,
} from "./primitives";

export interface CommandEnvelope<TPayload extends JsonValue = JsonValue> {
  commandId: EntityId;
  commandType: string;
  commandVersion: SchemaVersion;
  targetId: EntityId;
  expectedTargetVersion: number;
  actor: ActorRef;
  correlationId: EntityId;
  causationId?: EntityId;
  issuedAt: IsoDateTime;
  payload: TPayload;
}

export function assertCommandEnvelope(
  command: CommandEnvelope,
): asserts command is CommandEnvelope {
  assertNonEmptyString(command.commandId, "commandId");
  assertNonEmptyString(command.commandType, "commandType");
  assertNonEmptyString(command.commandVersion, "commandVersion");
  assertNonEmptyString(command.targetId, "targetId");
  assertPositiveInteger(command.expectedTargetVersion, "expectedTargetVersion");
  assertNonEmptyString(command.actor.id, "actor.id");
  assertNonEmptyString(command.correlationId, "correlationId");
  assertIsoDateTime(command.issuedAt, "issuedAt");
}
