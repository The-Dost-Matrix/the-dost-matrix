# Zichtlimieten — de getallen die bepalen hoeveel een rol mag zien

Opgesteld op 19 september 2026, naar aanleiding van drie los ontdekte
bovengrenzen op één dag.

## Waarom dit document bestaat

Op 19 september liep de geautomatiseerde beoordeling voor de tweede keer vast
op een afgekapte diff. De oorzaak was een constante van 16.000 tekens met als
hele onderbouwing: "zelfde reden als `MAX_KNOWLEDGE_CONTEXT_LENGTH` in
director-runtime.ts". Die constante staat op 6.000 en begrenst iets heel
anders. Het getal was verzonnen, met een verwijzing ernaast die het
onderbouwd liet lijken.

Datzelfde patroon bleek daarna op meer plekken te staan. Dit document
inventariseert ze, zodat ze één voor één afgewerkt kunnen worden in plaats van
dat ze opnieuw uit het zicht verdwijnen.

## De bevinding

In `src/` staan 68 numerieke constanten. **46 daarvan hebben een toelichting,
22 niet.** De verdeling is niet willekeurig:

- De goed onderbouwde getallen gaan over **gedrag en veiligheid**: wanneer
  iets hard moet stoppen, wanneer er geëscaleerd wordt, waarom een bestand
  niet stilzwijgend afgekapt mag worden. Die zijn met zorg geschreven, vaak
  ná een incident.
- De getallen zónder uitleg gaan bijna allemaal over **hoeveel een rol mag
  zien**.

Dat verschil is verklaarbaar en daarom gevaarlijk. Een verkeerde veiligheids-
grens geeft een incident, en een incident geeft een toelichting. Een te krappe
zichtgrens geeft geen incident: de rol doet het gewoon iets slechter, en dat
ziet er van buiten uit alsof het model dom is. Niemand gaat op zoek naar een
getal wanneer het antwoord alleen maar matig was.

**Deze grenzen zijn geen veiligheidsgrenzen.** De veiligheid van dit systeem
zit in `findHardEscalationReason`, in de CI-poort, in de risicoclassificatie
en in het oordeel van de beoordelaar. Minder laten zien maakt geen van die
vier strenger — het maakt ze blinder.

---

## 1 — Bijt nu

### `MAX_RELEVANT_KNOWLEDGE = 6`
`src/core/mission-engine/v2/director-runtime.ts:174`

De Director krijgt per aanroep hoogstens zes kennisitems mee. De Second Brain
bevat er 754 goedgekeurd. Dat is minder dan één procent per beslissing.

**Voorstel:** het vaste aantal vervalt. Wat overblijft is het tekenbudget
hieronder, plus relevantie als enige selectie.

### `MAX_KNOWLEDGE_CONTEXT_LENGTH = 6_000`
`src/core/mission-engine/v2/director-runtime.ts:175`

Zesduizend tekens kennis per aanroep. Ter vergelijking: het contextvenster van
de modellen die deze rol draait is een veelvoud daarvan, en één enkel
bestand mag elders in dit project 300.000 tekens groot zijn
(`MAX_FILE_CONTENT_LENGTH`, wél onderbouwd).

**Voorstel:** 60.000 tekens. Ongeveer 17.000 tokens, een paar cent per
aanroep, en grofweg veertig tot honderd kennisitems in plaats van zes.

**Let op — dit mag niet los:** bij het vullen wordt `break` gebruikt zodra één
item niet meer past. Niet "sla over en ga door", maar stoppen. Eén toevallig
lang item op plek drie haalt de hele rest van de lijst onderuit. Dat moet
`continue` worden.

**En er zit een tweede defect onder:** een kennisitem kan de relevantiedrempel
van 0,08 halen zónder één woord uit de zoekvraag te bevatten — 0,05 voor het
type plus 0,03 voor de levensfase is precies 0,08 bij nul tekstovereenkomst.
Dit is op 19 september gerepareerd voor het Second Brain-scherm met
`hasKeywordMatch` in `relevance.ts`; **de Director heeft die reparatie nooit
gekregen.** Het plafond verhogen zonder dit filter levert meer ruis op, geen
meer kennis.

### `MAX_CONVERSATION_CHUNKS = 12` en `MAX_TOTAL_ARCHIVE_CONTEXT_LENGTH = 30_000`
`src/core/application/director/director-memory.ts:39-40`

Hoeveel van het gespreksarchief de Director per vraag mag teruglezen: twaalf
fragmenten, samen dertigduizend tekens. Fragmenten zijn 6.000 tekens groot met
800 overlap (`chunk-service.ts`), dus die dertigduizend tekens zijn in de
praktijk al bereikt na vijf volle fragmenten — de twaalf wordt dan nooit
gehaald.

Dit is de grens die het dichtst ligt bij wat Elroy bedoelt met "alles wat wij
met elkaar hebben meegemaakt".

**Voorstel:** beide fors omhoog, en eerst uitzoeken welke van de twee in de
praktijk bindt. Twee grenzen op dezelfde stroom waarvan er één altijd als
eerste dichtklapt, is er één te veel.

### `MAX_FILES = 8`
`src/core/application/codebase/workspace-reader.ts:4`

De Director-chat kan hoogstens acht bestanden uit de codebase inzien, op 275.

**Voorstel:** omhoog, begrensd door `MAX_TOTAL_BYTES` (160.000) in plaats van
door een bestandsaantal. Die bytegrens doet het werk al; het aantal is een
tweede slot op dezelfde deur.

### `MAX_FILES_PER_ASSIGNMENT = 8`
`src/core/mission-engine/v2/builder-runtime.ts:91`

De Builder mag per toewijzing hoogstens acht bestanden aanraken. Dit is de
reden dat grotere klussen in stukjes moeten — niet omdat dat inhoudelijk beter
is, maar omdat hier acht staat.

**Voorstel:** onderbouwen of verhogen. Als acht klopt, moet erbij staan
waarom; als het niet klopt, moet het omhoog. Beide is beter dan nu.

---

## 2 — Bijt nog niet, maar met weinig marge

### `MAX_TREE_LENGTH = 20_000`
`src/core/mission-engine/v2/builder-runtime.ts:92`

De bestandsboom die de Builder krijgt om paden uit te kiezen, afgekapt op
20.000 tekens.

**Gemeten op 19 september 2026: de boom is 11.344 tekens voor 275 bestanden.**
Hij past dus, met een factor 1,8 speling. Rond de 480 bestanden begint de
Builder bestanden niet meer te zien.

Dat is precies het faalpatroon dat elders in ditzelfde bestand uitgebreid
staat gedocumenteerd: bij de globals.css-ramp leek de Builder "onzorgvuldig
bestaande CSS te laten vallen", terwijl hij die CSS simpelweg nooit had
gezien. De les die dáár is getrokken — nooit stilzwijgend afkappen, liever
hard stoppen met een duidelijke fout — is hier niet toegepast.

**Voorstel:** verhogen én de stilzwijgende `.slice()` vervangen door een
expliciete melding wanneer er iets buiten de boom valt.

### `MAX_CODEBASE_TREE_LENGTH = 24_000`
`src/core/application/chat/chat-service.ts:31`

Hetzelfde, voor de chat. Zelfde voorstel.

### `MAX_FILES_CONSIDERED = 40`
`src/core/mission-engine/v2/qa-runtime.ts:123`

QA haalt de volledige inhoud op van hoogstens veertig bestanden uit een pull
request. Ruim voor wat dit project nu doet, maar het staat direct naast
`MAX_FILE_CONTENT_LENGTH`, dat wél een toelichting van tien regels heeft.

**Voorstel:** laten staan, toelichting erbij.

### `MAX_MEMORY_CONTENT_LENGTH = 12_000`
`src/core/application/chat/chat-service.ts:30`

Hoeveel geheugen er in een chatprompt mag. Zelfde categorie als de twee
Director-grenzen hierboven; meenemen in dezelfde ronde.

---

## 3 — Waarschijnlijk prima, alleen niet opgeschreven

Deze zijn verdedigbaar. Ze hebben geen nieuw getal nodig, wel een regel uitleg
zodat een volgende sessie ze niet hoeft te raden.

- `DEFAULT_MAX_STEPS_PER_MISSION = 25` — `autonomous-advance.ts:107`. Rem op
  een missie die zichzelf rondjes laat draaien.
- `MAX_AUTOMATIC_REPAIR_ATTEMPTS = 2` — `mission-lifecycle.ts:6`. Echte
  beleidskeuze: hoe vaak mag het systeem zichzelf proberen te herstellen.
- `CHUNK_LENGTH = 6000` / `CHUNK_OVERLAP = 800` — `chunk-service.ts:1-2`.
  Bepaalt de korrelgrootte van het gespreksarchief, en dus indirect hoe goed
  terugzoeken werkt.
- `REQUEST_TIMEOUT_MS = 60_000` — `openai-provider.ts:16`. Een rolaanroep die
  langer duurt dan een minuut sterft. Bij grote bestanden is dat niet
  ondenkbaar; de moeite van het narekenen waard.
- `MAX_DOCUMENT_LENGTH = 120_000` — `knowledge/import/route.ts:19`. Staat naast
  `MAX_PARSED_TEXT_LENGTH = 118_000` in `parse-document.ts`. Twee getallen die
  bij elkaar horen en 2.000 uit elkaar liggen; controleren of die marge
  opzettelijk is.
- `MAX_CONTENT_LENGTH = 500_000` — `conversations/archive/route.ts:11`.
- `MAX_FILE_BYTES = 80_000` en `MAX_TOTAL_BYTES = 160_000` —
  `workspace-reader.ts:5-6`.
- `PARTICLE_COUNT = 5200`, `CONNECTION_DISTANCE = 0.065`,
  `MAX_CONNECTIONS = 1100` — `holographic-brain-scene-v2.tsx:8-10`. Cosmetisch.

---

## Al afgehandeld

### `MAX_RELEVANT_KNOWLEDGE` en `MAX_KNOWLEDGE_CONTEXT_LENGTH` — 20 september 2026
Van 6 items en 6.000 tekens naar 100 items en 60.000 tekens, met de rekensom
erbij. Het `break` in de opbouwlus is `continue` geworden, zodat één lang
kennisitem de rest van de lijst niet meer uit de prompt houdt. En de Director
kreeg eindelijk het keywordfilter dat het zoekscherm sinds 18 september al had:
een kennisitem moet nu werkelijk een woord uit de vraag bevatten, in plaats van
binnen te komen op type- en levensfasebonussen alleen.

### `MAX_FILES_CONSIDERED = 40` — 20 september 2026
Niet verhoogd maar hard gemaakt, na bevinding F-07 uit de externe review. Bij
meer gewijzigde bestanden dan QA volledig kan inlezen, stopt QA nu met een
duidelijke melding in plaats van een oordeel te vellen over een deel van de
wijziging. Mijn conclusie hierboven ("laten staan, toelichting erbij") was
fout: het probleem was niet het getal maar dat het stilzwijgend gebeurde.

In dezelfde ronde is `getPullRequestFiles` gaan doorbladeren. Die haalde één
pagina van 100 bestanden op en deed zich voor als de volledige lijst — óók
richting de risicoclassificatie die bepaalt of een wijziging naar de eigenaar
moet escaleren.


### `MAX_TOTAL_DIFF_CHARS`: 16.000 → 200.000 — 19 september 2026
`src/core/mission-engine/v2/automated-signoff.ts`

De aanleiding voor dit hele document. Verhoogd mét rekensom, en de tests
leiden hun omvang nu af van de constante, zodat een verlaging een test laat
omvallen in plaats van stilletjes escalaties te veroorzaken.

---

## Hoe we hiermee verder gaan

Eén afspraak, en die geldt vanaf nu voor elk nieuw getal in deze codebase:

> **Een constante die begrenst hoeveel een rol mag zien, krijgt een
> toelichting met de rekensom erbij — waar het getal vandaan komt, en wat het
> kost als het te laag staat. Geen verwijzing naar een andere constante als
> onderbouwing.**

En waar het kan: liever hard stoppen met een duidelijke melding dan
stilzwijgend afkappen. Dat is de les van globals.css, en ze geldt voor elk
getal in dit document.

## Over de methode, en waar ze blind is

De inventarisatie is gemaakt met een script dat zoekt naar
`const NAAM = <getal>;` en kijkt of er direct bóven die regel een
toelichting staat. Dat betekent:

- Staat de uitleg eronder, dan telt hij als "zonder toelichting". Dat is bij
  `MAX_TREE_LENGTH` gebeurd — de toelichting eronder blijkt bij de volgende
  constante te horen, dus de bevinding blijft staan, maar de methode kan
  elders wel een valse treffer geven.
- Getallen die niet in een constante staan maar rechtstreeks in de code, zijn
  niet gevonden.
- Getallen in omgevingsvariabelen en in de configuratie van Vercel vallen er
  ook buiten.

De lijst is dus een ondergrens, geen volledig beeld.
