# Owner and Strategy Layer Architecture

**Status:** Proposed for approval

## Purpose

The Owner and Strategy Layer connects the owner's long-term reasons to executable work.

It is the canonical owner of:

```text
Dream → Vision → Goal → Project → Mission
```

Tasks remain operational objects owned by missions.

## Ownership model

There is exactly one owner identity.

The owner can:

- create and amend dreams;
- approve visions and goals;
- prioritize projects;
- set boundaries and budgets;
- approve high-impact actions;
- override or stop any mission.

The Matrix may propose strategy, but may not silently redefine it.

## Strategic entities

### Dream

A durable desired future state.

```text
dream_id
title
description
why
status
priority
success_signals
constraints
created_at
updated_at
```

### Vision

A coherent interpretation of how a dream may be realized.

```text
vision_id
dream_id
statement
time_horizon
assumptions
status
owner_approval
```

### Goal

A measurable outcome supporting a vision.

```text
goal_id
vision_id
title
target
metric
target_date
priority
status
dependencies
```

### Project

A bounded body of work supporting one or more goals.

```text
project_id
title
goal_refs
purpose
status
priority
budget
risk_level
owner_constraints
```

### Mission

A concrete objective executed by Matrix Core.

Each mission must reference at least one project and one goal unless explicitly marked as maintenance or emergency work.

## Prioritization

The Director may recommend priority using:

- dream alignment;
- expected owner value;
- urgency;
- income potential;
- risk reduction;
- effort;
- dependencies;
- learning value;
- available time and budget.

The owner approves strategic priority changes.

## Traceability invariant

Every operational action must be traceable upward.

```text
task → mission → project → goal → vision → dream
```

Or it must carry an explicit exception reason.

## Strategic review

The Matrix periodically evaluates:

- whether goals remain relevant;
- whether projects still support goals;
- whether missions are producing useful progress;
- whether assumptions changed;
- whether owner time and money are being used effectively.

Reviews produce recommendations, not automatic strategic rewrites.
