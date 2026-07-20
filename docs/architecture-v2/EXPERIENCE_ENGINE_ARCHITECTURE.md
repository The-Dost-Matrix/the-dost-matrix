# Experience Engine Architecture

**Status:** Review required

## Purpose

The Experience Engine converts completed work into reusable lessons so the Matrix improves through evidence.

The Experience Engine analyzes outcomes. The Second Brain stores approved durable knowledge.

## Inputs

- mission objective;
- decision history;
- role assignments and results;
- tests and reviews;
- failures and retries;
- cost and timing;
- owner feedback;
- final outcome;
- relevant prior principles.

## Outputs

- experience records;
- reusable lessons;
- proposed principles;
- anti-patterns;
- process improvements;
- role-performance insights;
- model-performance insights;
- unresolved questions.

## Experience record

```text
experience_id
mission_id
project_id
objective
approach
outcome
what_worked
what_failed
root_causes
unexpected_results
evidence_refs
confidence
reusability
scope
recommended_action
created_at
```

## Learning cycle

```text
Mission completed or failed
→ Collect evidence
→ Compare intended and actual outcome
→ Identify likely causes
→ Extract candidate lessons
→ Check existing knowledge
→ Validate
→ Request approval when needed
→ Store
→ Reuse in future context
```

## Reflection triggers

Mission completion, mission failure, repeated retries, owner rejection, high cost, major architectural change, safety incident, unexpected success or explicit owner request.

## Lesson classes

- Tactical
- Process
- Technical
- Strategic
- Owner preference
- Anti-pattern

## Validation

Lessons are checked for evidence quality, causal plausibility, generalizability, conflicts, owner intent, overfitting risk, scope and reversibility.

The engine must distinguish correlation, likely cause, confirmed cause, preference and universal rule.

## Principle promotion

A lesson becomes a principle only when evidence is sufficient, scope is clear, conflicts are resolved and required owner approval is obtained.

## Application

Relevant lessons may influence Director decisions, role selection, model routing, review depth, retry strategy and task decomposition. The Experience Engine never controls execution directly.

## Safety

The engine must not learn universal rules from single events, hide uncertainty, silently modify owner preferences or convert model opinions into facts.
