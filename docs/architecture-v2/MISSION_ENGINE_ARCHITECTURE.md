# Mission Engine Architecture

**Status:** Proposed for approval

## Purpose

The Mission Engine is the sole operational authority for mission state and execution.

The Director decides what should happen. The Mission Engine validates and performs that decision.

## Mission aggregate

```text
mission_id
project_id
goal_refs
title
objective
status
priority
risk_level
budget
success_criteria
constraints
current_decision_id
active_assignment_ids
owner_approval_state
version
created_at
updated_at
```

## State machine

```text
DRAFT
  → READY
  → ACTIVE
  → WAITING_FOR_ROLE
  → ACTIVE
  → WAITING_FOR_OWNER
  → ACTIVE
  → WAITING_FOR_APPROVAL
  → ACTIVE
  → REPLANNING
  → ACTIVE
  → COMPLETED

Any active state may transition to:
PAUSED
FAILED
CANCELLED
```

## Invariants

- Only the Mission Engine changes mission state.
- Every transition requires a command and emits an event.
- Every command includes an expected aggregate version.
- Completed and cancelled missions are immutable except for annotations.
- A mission cannot complete without evaluated success criteria.
- A mission cannot exceed budget or permission boundaries.
- High-risk actions require explicit approval.

## Commands

```text
CreateMission
ActivateMission
ApplyDirectorDecision
DispatchRoleAssignment
RecordRoleResult
RequestOwnerInput
RecordOwnerInput
RequestApproval
RecordApproval
PauseMission
ResumeMission
ReplanMission
CompleteMission
FailMission
CancelMission
```

## Decision handling

For every Director Decision:

1. validate schema;
2. validate current mission state;
3. validate permissions and budget;
4. validate required approval;
5. ensure idempotency;
6. execute one bounded state change or assignment;
7. persist state;
8. emit domain events.

## Recovery

A mission resumes from persisted state.

Recovery must identify:

- last committed mission version;
- pending assignments;
- timed-out work;
- unprocessed events;
- unresolved approvals;
- last Director decision.

## Concurrency

Mission updates use optimistic concurrency.

Only one accepted state transition may apply to a mission version. Conflicting commands are rejected and reevaluated.

## Completion

Completion requires:

- all mandatory criteria evaluated;
- required artifacts persisted;
- no active assignments;
- unresolved risks recorded;
- required owner approval;
- final Director decision;
- experience reflection scheduled.
