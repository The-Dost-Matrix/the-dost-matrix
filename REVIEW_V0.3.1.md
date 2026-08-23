# The Dost Matrix v0.3.1 — review en hardening

## Uitgevoerde verbeteringen

- Chat API expliciet op Node.js-runtime gezet en caching uitgeschakeld.
- Authenticatiefouten geven geen interne Firebase-details meer terug.
- Maximale berichtlengte van 8.000 tekens toegevoegd.
- Providerfouten worden server-side gelogd, maar niet inclusief response-body naar de browser gelekt.
- Time-out van 60 seconden toegevoegd aan OpenAI- en Anthropic-aanroepen.
- Lege of afwijkende providerresponses worden gecontroleerd.
- Embedding wordt per bericht nog maar één keer opgevraagd en daarna hergebruikt.
- Second Brain bewaart nu de volledige uitwisseling (gebruiker + assistent) in plaats van alleen de gebruikersvraag.
- Hardcoded persoonlijke naam uit de systeemprompt verwijderd, zodat multi-user gebruik veiliger is.
- Prompt-injection-grens toegevoegd: herinneringen gelden als brongegevens, niet als systeeminstructies.
- Ontbrekende Firestore-indexen toegevoegd voor missions, chatMessages en knowledge.
- Enter-verzending in de chatpagina typeveilig gemaakt.
- Voorbeeldomgeving ontdaan van projectspecifieke Firebase-configuratie.
- Versienummer bijgewerkt naar v0.3.1.

## Validatie

Geslaagd:
- package.json, package-lock.json en firestore.indexes.json zijn geldige JSON.
- Geen merge-conflictmarkeringen aangetroffen.
- Leveringspakket bevat geen `.env.local`, `.git`, `node_modules` of geneste tijdelijke ZIP.

Nog lokaal uitvoeren:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
firebase deploy --only firestore:rules,firestore:indexes
```

De dependency-installatie kon in de reviewomgeving niet worden voltooid doordat `npm ci` tweemaal op time-out liep. Daardoor kon de volledige Next.js-build hier niet definitief worden bevestigd.

## Eerstvolgende technische prioriteiten

1. Conversaties/threads introduceren in plaats van één onbeperkte tijdlijn per eigenaar.
2. Rate limiting en abuse protection op `/api/chat` toevoegen.
3. Second Brain laten samenvatten, dedupliceren en expliciet laten goedkeuren wat blijvend wordt onthouden.
4. Retrieval migreren van maximaal 500 Firestore-documenten naar een echte vectorindex.
5. Integratie- en securitytests toevoegen voor auth, tenant-isolatie, providerfouten en prompt-injection.
