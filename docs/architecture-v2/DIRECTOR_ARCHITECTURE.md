# Director Architecture

**Status:** Review required

## Purpose

The Director is the sole logical strategic authority of The Dost Matrix. It interprets owner intent, chooses the next best action, evaluates results and determines mission completion.

It is the CPU of the Matrix, but not the operating system.

## Responsibilities

The Director:

- connects owner intent to dreams, goals and projects;
- defines mission objectives and success criteria;
- identifies missing information;
- selects roles by capability;
- specifies model requirements;
- evaluates role results;
- detects drift, failure and uncertainty;
- replans after new evidence;
- requests owner input or approval;
- proposes knowledge and lessons;
- decides when a mission is complete.

The Director does not directly write databases, invoke providers, mutate mission state or bypass policies.

## Control loop

```text
Observe → Orient → Decide → Delegate → Evaluate → Continue or learn
```

The Director commits only the next bounded action. It may keep a provisional plan, but it reevaluates after every meaningful result.

## Stateless reasoning

The Director has no hidden durable memory. Continuity is reconstructed from mission state, decision history, Second Brain context, Result Store outputs, owner preferences and Experience Engine rules.

## Role selection

Selection is based on capability, tools, risk, output type, context sensitivity, prior performance, cost and required independence. No fixed role chain is mandatory.

## Model relationship

The Director describes required capabilities and constraints. The Model Router chooses the actual provider and model. Provider names are fixed only when the owner explicitly requires one.

## Result evaluation

Every assignment has success criteria. The Director may accept, reject, request revision, request independent review, combine outputs or escalate to the owner.

## Model Council

For high-impact or uncertain decisions, the Director may request several independent model analyses followed by a judge or synthesis role. The council advises; the Director makes the decision.

## Guardrails

The Director must expose uncertainty, separate facts from assumptions, preserve owner intent, obey budgets and permissions, avoid irreversible actions without approval and document important rationale.

## Completion

A mission completes only when its objective is satisfied, deliverables exist, required tests or reviews pass, unresolved risks are documented, required approval is obtained and outputs are persisted.
