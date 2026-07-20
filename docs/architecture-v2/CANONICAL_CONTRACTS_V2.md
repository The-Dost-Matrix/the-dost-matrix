# Canonical Contracts V2

**Status:** Proposed for approval

## Purpose

This document is the single source of truth for cross-component contracts.

Provider-specific and storage-specific types may not leak into these contracts.

## Identifier rules

All durable entities use opaque, globally unique identifiers.

Identifiers are immutable and never encode business meaning.

## Common metadata

```text
id
version
created_at
updated_at
created_by
correlation_id
causation_id
```

## Command envelope

```text
command_id
command_type
command_version
target_id
expected_target_version
actor
correlation_id
causation_id
issued_at
payload
```

## Director Decision

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

## Role Assignment

```text
assignment_id
mission_id
role_id
role_version
objective
instructions
input_refs
context_package_ref
constraints
success_criteria
allowed_tools
budget
deadline
model_requirements
approval_rules
created_at
```

## Role Result

```text
result_id
assignment_id
mission_id
status
summary
deliverables
evidence
assumptions
uncertainties
risks
recommendations
success_criteria_results
artifact_refs
usage
created_at
```

## Context Package

```text
context_package_id
mission_id
assignment_id
objective
owner_preferences
active_decisions
facts
principles
experiences
source_fragments
known_uncertainties
excluded_data_summary
token_budget
created_at
```

## Approval Request

```text
approval_id
mission_id
action
reason
risk_class
estimated_cost
data_exposure
expires_at
status
requested_at
resolved_at
```

## Contract versioning

- Every serialized command, event and public record has a schema version.
- Additive changes may remain backward compatible.
- Breaking changes require a new major contract version.
- Historical records retain their original version.
- Adapters translate between versions at system boundaries.

## Validation

All cross-component messages are validated at runtime before use.

Invalid messages are rejected, audited and never silently coerced.
