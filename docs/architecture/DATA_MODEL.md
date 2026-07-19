# Datamodel

## Algemene velden

Elke entiteit bevat minimaal `id`, `ownerId`, `createdAt`, `updatedAt` en `schemaVersion`. Tijd wordt in UTC opgeslagen.

## Kernentiteiten

### Owner
De enige Eigenaar, met identiteit, voorkeuren, taal, tijdzone, beveiligingsinstellingen en standaardmandaten.

### Mission
Velden: titel, doel, context, status, prioriteit, currentVersionId, acceptatiecriteria, constraints, riskLevel, parentMissionId, dependencyMissionIds en dueAt.

Status: `draft`, `planned`, `awaiting_approval`, `active`, `paused`, `blocked`, `completed`, `failed`, `cancelled`.

### MissionVersion
Onveranderlijke versie van doel, context, randvoorwaarden en acceptatiecriteria.

### Task
Velden: missionId, type, instructies, status, assignedRole, assignedInstanceId, dependencyTaskIds, inputRefs, expectedOutput, attemptCount, maxAttempts, riskLevel, approvalRequirement en resultRef.

### TaskAttempt
Onveranderlijk record van invoer, context, model, duur, uitvoer, fouten en kosten.

### Event
Onveranderlijke gebeurtenis met eventType, aggregateType, aggregateId, payload, actor, correlationId, causationId en occurredAt.

### RoleDefinition / RoleInstance
Definitie van verantwoordelijkheid en tijdelijke runtime-uitvoering.

### Approval / Mandate
Specifieke toestemming respectievelijk vooraf verleende bevoegdheid binnen grenzen.

### Artifact
Resultaat met type, naam, versie, storageRef, contentHash, missionId, taskId, maker, sourceRefs, qualityStatus en classification.

### KnowledgeSource / KnowledgeChunk
Originele bron en doorzoekbaar fragment met herkomst, locatie, classificatie, geldigheid en verificatiestatus.

### Memory
Geconsolideerde herinnering met type, inhoud, bronnen, confidence, geldigheid en gebruiksregels.

### AuditEntry
Onveranderlijk beveiligings- of bestuursrecord.

## Relaties

Een Mission heeft meerdere MissionVersions en Tasks. Een Task heeft meerdere TaskAttempts en produceert Artifacts. Artifacts en Memories verwijzen naar bronnen. Approvals en Mandates autoriseren acties. Events leggen overgangen vast.
