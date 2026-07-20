# Event, Result and Audit Architecture

**Status:** Proposed for approval

## Purpose

This architecture provides traceability between decisions, execution, outputs and evidence.

## Domain event envelope

```text
event_id
event_type
event_version
aggregate_type
aggregate_id
aggregate_version
correlation_id
causation_id
actor_type
actor_id
occurred_at
recorded_at
payload
metadata
```

Events are immutable.

## Delivery guarantees

The initial target is at-least-once delivery.

Consumers must be idempotent.

Ordering is guaranteed per aggregate, not globally.

Failed events enter a dead-letter flow with diagnostic information.

## Core event families

```text
owner.*
strategy.*
mission.*
director.*
role.*
model.*
result.*
knowledge.*
experience.*
policy.*
audit.*
system.*
```

Examples:

```text
mission.created
mission.activated
director.decision_created
role.assignment_started
role.assignment_completed
result.persisted
policy.approval_requested
experience.lesson_proposed
```

## Result Store

The Result Store owns generated outputs.

A result record contains:

```text
result_id
mission_id
assignment_id
result_type
status
summary
content_ref
artifact_refs
evidence_refs
schema_version
producer
usage
quality_evaluation
created_at
```

Large files live in an artifact store and are referenced by immutable identifiers.

## Audit Ledger

The Audit Ledger stores append-only evidence for:

- owner commands;
- Director decisions;
- approvals;
- mission state transitions;
- role tool usage;
- model selection;
- cost;
- knowledge writes;
- deletions;
- security-relevant actions.

Audit records must contain enough data to reconstruct who or what caused an action without storing unnecessary sensitive prompt content.

## Outbox pattern

State changes and their events are committed atomically through an outbox.

The publisher delivers pending events after the state transaction commits.

This prevents state from changing without its corresponding event.

## Retention

- Mission and decision history: durable.
- Audit evidence: durable according to owner policy.
- Raw provider payloads: minimized and time-limited.
- Sensitive prompt content: redacted or omitted where possible.
- Artifacts: owner-controlled retention.
