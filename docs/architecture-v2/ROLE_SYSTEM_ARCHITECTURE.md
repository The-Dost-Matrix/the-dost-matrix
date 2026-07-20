# Role System Architecture

**Status:** Review required

## Purpose

The Role System provides specialized, bounded AI workers. Roles execute assignments issued by the Director through Matrix Core.

Roles are capabilities, not independent governing agents.

## Core rules

- The Director decides.
- Matrix Core dispatches.
- Roles execute.
- Roles cannot redefine the mission.
- Roles cannot silently expand scope.
- Roles receive least-privilege context and tools.
- Every execution is auditable.

## Role definition

```text
role_id
name
purpose
capabilities
input_contract
output_contract
allowed_tools
knowledge_permissions
model_requirements
execution_limits
quality_rules
review_requirements
version
```

## Assignment contract

```text
assignment_id
mission_id
role_id
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
```

## Initial catalogue

- Architect
- Researcher
- Builder
- Reviewer
- QA
- Chronicler
- Strategist
- Creative Director

The catalogue is extensible without changing Matrix Core.

## Lifecycle

```text
CREATED
VALIDATED
QUEUED
RUNNING
WAITING_FOR_TOOL
COMPLETED
FAILED
CANCELLED
REJECTED
```

Every transition emits an event.

## Context isolation

A role receives only its objective, required mission context, relevant knowledge, approved tools, constraints, success criteria and output schema.

## Tool permissions

Access to files, web, code execution, email, calendar, deployment, purchasing or other systems is explicit. High-impact tools require approval and policy checks.

## Communication

Roles do not communicate through hidden conversations. They communicate through persisted results, events, artifacts and Director-mediated assignments.

## Structured result

```text
assignment_id
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
```

## Review patterns

- Builder → QA
- Architect → Reviewer
- Researcher → Reviewer
- Independent roles → Synthesis

The Director chooses the pattern.

## Safety and limits

The Role Runtime enforces timeouts, token limits, cost limits, tool limits, filesystem boundaries, approval gates, output validation, cancellation and redaction.

## Performance

Track success, revision rate, owner acceptance, QA pass rate, latency, cost, tool errors, evidence failures and schema compliance.
