# ADR-001 — Firebase als Foundation-backend

Status: Accepted  
Date: 2026-07-18

## Context
The Dost Matrix needs authentication, realtime mission updates, auditable data
and a low-maintenance starting point.

## Decision
Use a separate Firebase project named `the-dost-matrix`, with:
- Firebase Authentication
- Cloud Firestore in `europe-west4`
- Production security rules
- Storage deferred until required

## Consequences
- Fast Foundation development
- Realtime client synchronization
- Separate security boundary from Dost Industries
- Storage and server administration can be added later
- Architecture must keep Firebase behind domain services to preserve migration options
