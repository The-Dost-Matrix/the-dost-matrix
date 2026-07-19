# Technische architectuur

## Huidige stack

- Next.js App Router
- TypeScript
- Firebase Authentication
- Cloud Firestore
- server-side uitvoeringslogica
- externe AI-modellen via adapters

## Structuur

```text
src/
  app/
  components/
  modules/
    missions/
    tasks/
    events/
    roles/
    approvals/
    artifacts/
    knowledge/
    memory/
    security/
  core/
    domain/
    application/
    orchestration/
    contracts/
  infrastructure/
    firebase/
    ai/
    storage/
    search/
    observability/
  shared/
    types/
    validation/
    errors/
```

## Regels

- Domeinlogica MAG NIET rechtstreeks afhankelijk zijn van Next.js, Firebase of een AI-provider.
- AI-aanroepen, geheimen, permissiecontrole en muterende acties vinden server-side plaats.
- Alle grensvlakdata wordt runtime gevalideerd met versieerbare schema's.
- Elke muterende opdracht gebruikt een idempotency key.
- Externe providers worden benaderd via adapters voor modelselectie, gestructureerde uitvoer, time-outs, retries, kosten, logging en foutnormalisatie.

## Hoofdcollecties

```text
owners
missions
missionVersions
tasks
taskAttempts
events
roles
roleInstances
approvals
mandates
artifacts
knowledgeSources
knowledgeChunks
memories
auditEntries
systemSettings
```

## Teststrategie

Unit tests voor domeinregels, contracttests voor adapters, integratietests voor authenticatie en opslag, security-rule tests, missiescenario's, AI-evaluaties en regressietests.

## Deployment

Deployment vereist succesvolle linting, typecontrole, tests, security checks en productiebuild. Development en production gebruiken gescheiden gegevens en geheimen.
