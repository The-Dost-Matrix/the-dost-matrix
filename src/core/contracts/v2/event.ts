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

export interface DomainEventEnvelope<TPayload extends JsonValue = JsonValue> {
  eventId: EntityId;
  eventType: string;
  eventVersion: SchemaVersion;
  aggregateType: string;
  aggregateId: EntityId;
  aggregateVersion: number;
  correlationId: EntityId;
  causationId?: EntityId;
  actor: ActorRef;
  occurredAt: IsoDateTime;
  recordedAt: IsoDateTime;
  payload: TPayload;
  metadata: Record<string, JsonValue>;
}

export function assertDomainEventEnvelope(
  event: DomainEventEnvelope,
): asserts event is DomainEventEnvelope {
  assertNonEmptyString(event.eventId, "eventId");
  assertNonEmptyString(event.eventType, "eventType");
  assertNonEmptyString(event.eventVersion, "eventVersion");
  assertNonEmptyString(event.aggregateType, "aggregateType");
  assertNonEmptyString(event.aggregateId, "aggregateId");
  assertPositiveInteger(event.aggregateVersion, "aggregateVersion");
  assertNonEmptyString(event.correlationId, "correlationId");
  assertNonEmptyString(event.actor.id, "actor.id");
  assertIsoDateTime(event.occurredAt, "occurredAt");
  assertIsoDateTime(event.recordedAt, "recordedAt");
}
