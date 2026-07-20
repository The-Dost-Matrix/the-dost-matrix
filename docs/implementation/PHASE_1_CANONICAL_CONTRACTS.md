# Phase 1 — Canonical Contracts

## Status

Implemented without new dependencies.

## Added

`src/core/contracts/v2/` contains the canonical V2 contracts for commands, Director decisions, domain events, role assignments, role results, context packages, approvals and shared primitives.

## Compatibility

- Existing V1 runtime remains unchanged.
- `package.json` and `package-lock.json` are restored to their original repository versions.
- No `npm install` is required.
- No external dependency was added.

## Verification

Run:

```powershell
npm run lint
npm run typecheck
npm run build
```
