# Eventmodel

## Eigenschappen

Events zijn onveranderlijk, versieerbaar, herleidbaar en idempotent verwerkbaar. Eventnamen staan in verleden tijd.

## Envelope

```ts
type EventEnvelope<T> = {
  id: string;
  eventType: string;
  eventVersion: number;
  ownerId: string;
  aggregateType: string;
  aggregateId: string;
  missionId?: string;
  taskId?: string;
  correlationId: string;
  causationId?: string;
  actor: { type: "owner" | "role" | "system"; id: string };
  occurredAt: string;
  payload: T;
};
```

## Kerngebeurtenissen

- Missies: `mission.created`, `mission.versioned`, `mission.planned`, `mission.activated`, `mission.paused`, `mission.resumed`, `mission.blocked`, `mission.completed`, `mission.failed`, `mission.cancelled`.
- Taken: `task.proposed`, `task.created`, `task.ready`, `task.assigned`, `task.started`, `task.blocked`, `task.output_submitted`, `task.approved`, `task.rejected`, `task.completed`, `task.failed`.
- Rollen: `role.instance_started`, `role.instance_heartbeat`, `role.instance_stopped`, `role.output_produced`, `role.escalation_requested`.
- Goedkeuringen: `approval.requested`, `approval.granted`, `approval.denied`, `approval.expired`, `approval.revoked`.
- Kennis: `knowledge.source_added`, `knowledge.source_processed`, `knowledge.chunk_indexed`, `knowledge.claim_verified`, `memory.created`, `memory.invalidated`.
- Artefacten: `artifact.created`, `artifact.versioned`, `artifact.validated`, `artifact.rejected`, `artifact.published`.

Consumers bewaren checkpoints. Mislukte verwerking gaat naar een dead-lettermechanisme. Binnen één aggregate wordt volgorde bewaakt. Gevoelige inhoud staat achter beveiligde verwijzingen.
