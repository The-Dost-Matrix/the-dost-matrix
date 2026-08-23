# Phase 2 — Matrix Core V2 Mission Engine

## Status

Implementation complete.

## Scope

This phase adds a dependency-free Mission Engine V2 beside the existing V1 runtime.

## Included

- Mission aggregate and invariants
- Complete state machine
- Structured command handlers
- Director Decision processing
- Active assignment administration
- Owner input and approval handling
- Success criterion evaluation
- Completion guards
- Command idempotency
- Optimistic concurrency
- Atomic state-and-outbox commits
- In-memory store
- Executable verification scenario

## Architectural guarantees

- Only the Mission Engine mutates mission state.
- Every accepted command creates exactly one immutable outbox event.
- State and outbox event are committed atomically by the store contract.
- Duplicate commands are rejected.
- Mission versions are checked before mutation.
- Unknown or inactive role assignments cannot return results.
- Missions cannot complete with active assignments, open owner actions, rejected approvals or unmet criteria.
- V1 code is not modified.

## Files

```text
src/core/mission-engine/v2/
├── commands.ts
├── engine.ts
├── events.ts
├── index.ts
├── mission.ts
├── state-machine.ts
├── store.ts
└── verification.ts
```
