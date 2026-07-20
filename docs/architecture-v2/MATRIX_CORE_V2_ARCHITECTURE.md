# Matrix Core V2 Architecture

**Status:** Review required  
**Depends on:** `MATRIX_MANIFEST.md`

## Purpose

Matrix Core is the runtime, control plane and governance layer of The Dost Matrix. It converts owner intent into controlled, recoverable and auditable execution.

## System position

```text
Owner
  ↓
Owner Interface
  ↓
Matrix Core
  ├── Director Runtime
  ├── Mission Engine
  ├── Role Runtime
  ├── Model Router
  ├── Context Orchestrator
  ├── Second Brain
  ├── Experience Engine
  ├── Event Bus
  ├── Result Store
  ├── Policy Engine
  └── Audit Ledger
```

## Responsibility boundaries

- **Director:** strategic reasoning and next-action decisions.
- **Mission Engine:** validates and executes Director decisions.
- **Role Runtime:** runs bounded specialist assignments.
- **Model Router:** selects an allowed provider and model.
- **Context Orchestrator:** assembles minimal relevant context.
- **Second Brain:** durable owner knowledge.
- **Experience Engine:** lessons and proposed principles.
- **Result Store:** outputs, artifacts and evaluations.
- **Event Bus:** immutable domain-event distribution.
- **Policy Engine:** permissions, approvals and limits.
- **Audit Ledger:** append-only evidence of important actions.

## Canonical execution loop

```text
1. Owner expresses intent
2. Matrix Core creates or updates a mission
3. Director evaluates mission state and context
4. Director emits one structured decision
5. Mission Engine validates the decision
6. Role Runtime executes bounded work
7. Result Store persists the result
8. Director evaluates the result
9. Director continues, replans, asks approval or completes
10. Experience Engine extracts lessons
11. Approved knowledge enters the Second Brain
```

The flow is dynamic. Hardcoded role chains are not the primary planning mechanism.

## Mission states

```text
DRAFT
READY
ACTIVE
WAITING_FOR_ROLE
WAITING_FOR_OWNER
WAITING_FOR_APPROVAL
REPLANNING
PAUSED
COMPLETED
FAILED
CANCELLED
```

Only the Mission Engine may mutate mission state.

## Director Decision contract

A decision contains at least:

```text
decision_id
mission_id
decision_type
reason
next_action
assigned_role
required_capabilities
context_requirements
model_constraints
approval_requirement
success_criteria
failure_strategy
created_at
```

Supported decision types:

```text
DISPATCH_ROLE
REQUEST_OWNER_INPUT
REQUEST_APPROVAL
REPLAN
PAUSE_MISSION
COMPLETE_MISSION
CANCEL_MISSION
STORE_KNOWLEDGE
EVALUATE_RESULT
```

## Reliability

- Commands and decisions are idempotent.
- State is checkpointed after each meaningful transition.
- Interrupted missions can resume.
- Retries are bounded and classified.
- Invalid events enter a dead-letter flow.
- Cancellation prevents future work without corrupting completed results.
- Every execution keeps correlation and causation identifiers.

## Security

Every action is checked against owner identity, mission scope, role permission, data sensitivity, provider policy, tool permission, budget and approval requirements.

Secrets must not enter prompts unless explicitly required and permitted.

## Prohibited architecture

- Hardcoded workflow sequences as strategic intelligence.
- Roles governing other roles.
- Provider-specific payloads in domain objects.
- Silent state mutation.
- Knowledge without provenance.
- Unbounded autonomous loops.
- Business decisions inside repositories.
- One LLM acting as the entire system.

## Acceptance criteria

Matrix Core V2 is ready for implementation when responsibilities, domain contracts, state transitions, events, failure modes, approvals, storage boundaries and recovery behavior are all explicit and testable.
