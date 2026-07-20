# Second Brain Architecture

**Status:** Review required

## Purpose

The Second Brain is the owner's durable knowledge layer. It supplies relevant, traceable context independently from any model provider.

It is not a raw document dump and not merely a vector database.

## Knowledge types

- Facts
- Decisions
- Experiences
- Principles
- Preferences
- Entities
- Relationships
- Sources

## Knowledge record

```text
knowledge_id
knowledge_type
title
content
summary
owner_scope
project_scope
mission_scope
source_refs
provenance
confidence
sensitivity
valid_from
valid_until
supersedes
contradicts
status
tags
created_at
updated_at
```

## Provenance

Every item records where it came from, when it was created, whether it was observed, inferred or generated, which role or model transformed it and whether owner approval was required.

Generated conclusions without provenance cannot be treated as established facts.

## Lifecycle

```text
CANDIDATE → VALIDATED → ACTIVE → SUPERSEDED or ARCHIVED
```

Additional states may include `DISPUTED` and `DELETED`.

## Ingestion

```text
Source
→ Extraction
→ Normalization
→ Classification
→ Entity linking
→ Deduplication
→ Confidence assignment
→ Policy check
→ Persistence
→ Indexing
```

## Retrieval

Retrieval combines semantic similarity, exact search, entity relationships, project scope, mission scope, time, knowledge type, confidence, recency and contradiction state.

The goal is not maximum context. It is the smallest relevant context package.

## Contradictions

Conflicting claims are preserved. Their provenance, confidence and recency are compared. One may become active, but the other is not silently overwritten.

## Decisions

Important decisions are stored as ADR-style records containing context, alternatives, chosen option, rationale, consequences, status and approval.

## Principles

Principles have scope, priority, evidence, approval state, exceptions and version history. High-impact principles require owner approval.

## Privacy and portability

Knowledge access is filtered by role, mission, sensitivity, provider and purpose. The owner can inspect, export, migrate and delete knowledge. The canonical format may not depend on one database vendor.
