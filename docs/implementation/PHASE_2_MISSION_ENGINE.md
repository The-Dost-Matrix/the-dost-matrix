# Phase 2 — Mission Engine V2

## Scope

Dependency-free operational Mission Engine based on the approved V2 architecture.

## Added

- Versioned Mission aggregate.
- Explicit state machine and transition validation.
- Optimistic concurrency through expected versions.
- Mission repository interface and in-memory implementation.
- Director Decision execution.
- Role-result processing.
- Completion, failure, cancellation, pause and resume flows.
- Canonical domain-event publication.

## Deliberately unchanged

The existing V1 mission, workflow and Firebase runtime remain untouched. Migration happens in a later integration phase.
