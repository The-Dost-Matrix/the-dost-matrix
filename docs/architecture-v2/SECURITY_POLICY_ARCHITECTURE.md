# Security and Policy Architecture

**Status:** Proposed for approval

## Purpose

The Security and Policy Layer decides whether an intended action is allowed, denied or requires owner approval.

## Policy decision contract

```text
policy_decision_id
subject
action
resource
mission_id
risk_class
data_classification
provider
tool
estimated_cost
decision
reason
required_approval
expires_at
created_at
```

Possible decisions:

```text
ALLOW
DENY
REQUIRE_OWNER_APPROVAL
REQUIRE_ADDITIONAL_REVIEW
```

## Risk classes

### R0 — Read-only and reversible

Examples: read approved project context, classify text.

### R1 — Low-impact mutation

Examples: create a local draft or generated artifact.

### R2 — External or material action

Examples: send email, publish content, modify a shared calendar, deploy to staging.

### R3 — Financial, legal, privacy or production impact

Examples: spend money, deploy to production, delete durable knowledge, expose sensitive data.

### R4 — Prohibited or owner-only

Actions outside delegated authority.

Default approval policy:

- R0: automatic when permitted.
- R1: automatic within mission boundaries.
- R2: configurable approval.
- R3: explicit owner approval.
- R4: denied unless directly performed by the owner through a dedicated control.

## Data classification

```text
PUBLIC
INTERNAL
CONFIDENTIAL
HIGHLY_SENSITIVE
SECRET
```

Provider and tool access is filtered by data class.

## Least privilege

Roles receive only the tools, knowledge and scope required for their assignment.

Permissions expire with the assignment.

## Budgets

Policy enforcement includes:

- per-assignment cost;
- per-mission cost;
- daily and monthly limits;
- model restrictions;
- tool-use limits;
- execution time limits.

## Secret management

Secrets are stored outside prompts and source code.

Provider adapters receive only the secret required for their provider.

Secrets are redacted from logs, events and errors.

## Owner control

The owner can:

- inspect permissions;
- revoke access;
- pause all execution;
- block providers or tools;
- set approval thresholds;
- export audit evidence;
- delete owner-controlled data.

## Safe failure

When policy evaluation is unavailable or ambiguous, high-impact actions fail closed.
