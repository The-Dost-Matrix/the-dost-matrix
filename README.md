# The Dost Matrix v0.3.1

De eerste echte Next.js- en Firebase-codebase.

## Wat werkt

- Firebase Authentication met e-mail/wachtwoord
- Beveiligde dashboardroute
- Realtime missies in Cloud Firestore
- Auditgebeurtenis bij iedere nieuwe missie
- Firestore-regels volgens least privilege
- Matrix City en Mission Center
- TypeScript strict mode
- Model- en provider-onafhankelijke projectstructuur

## Installeren

Vereisten:
- Node.js 22 of nieuwer
- npm
- Git

```bash
npm install
```

Kopieer daarna het voorbeeldbestand:

Windows PowerShell:

```powershell
Copy-Item .env.local.example .env.local
```

macOS/Linux:

```bash
cp .env.local.example .env.local
```

Start de applicatie:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Firestore-regels publiceren

Installeer eerst de Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase use the-dost-matrix
firebase deploy --only firestore:rules,firestore:indexes
```

## Firestore-index

De missiequery gebruikt `ownerId` plus `createdAt`. Firestore kan bij de eerste
uitvoering vragen om een samengestelde index. De foutmelding bevat een directe
link waarmee je die index kunt aanmaken.

Benodigde index:
- Collection: `missions`
- Field `ownerId`: Ascending
- Field `createdAt`: Descending

De missielijst van Mission Engine V2 (op het hoofdscherm en op
`/dashboard/missions-v2`) gebruikt `ownerId` plus `updatedAt` op de
`missionEngineV2Missions`-collectie en heeft om dezelfde reden een eigen
index nodig:
- Collection: `missionEngineV2Missions`
- Field `ownerId`: Ascending
- Field `updatedAt`: Descending

Beide indexen staan al in `firestore.indexes.json` — je hoeft de link uit de
foutmelding dus niet te gebruiken. Rol ze uit met:

```bash
firebase deploy --only firestore:indexes
```

## Eerste account

Open `/login`, kies **Account aanmaken** en gebruik je eigen e-mailadres met een
sterk, uniek wachtwoord. Registratie kunnen we na het eerste account in een
volgende sprint uitschakelen of beperken tot toegestane gebruikers.

## Chat + Second Brain (nieuw)

Eerste werkende versie: chatten met een LLM (Anthropic of OpenAI, kies zelf
via env vars) in `/dashboard/chat`, met een Second Brain die elk gesprek
automatisch opslaat in Firestore en relevante stukken terugvindt bij een
volgende vraag.

**Hoe het werkt**
- De browser praat nooit rechtstreeks met een LLM-provider. Elk bericht gaat
  naar `/api/chat`, een server-side route die eerst je Firebase-sessietoken
  verifieert (via Firebase Admin) en pas dan de LLM-key gebruikt.
- De Model Router (`src/core/llm/model-router.ts`) kiest automatisch Anthropic
  als `ANTHROPIC_API_KEY` gezet is, anders OpenAI. Dit is bewust de eerste,
  simpele versie van de "Model Router" uit het dashboard-ontwerp.
- Second Brain-opslag (`knowledge`-collectie) gebruikt embeddings voor
  semantisch zoeken als `OPENAI_API_KEY` beschikbaar is; zonder embeddings
  valt het terug op keyword-matching, zodat het ook werkt met alléén een
  Anthropic-key.
- Elke user-boodschap wordt nu 1-op-1 als kennis opgeslagen (geen samenvatting
  of filtering). Dat is bewust minimaal: eerst bewijzen dat de hele lus werkt,
  daarna slimmer maken (samenvatten, dedupliceren, tags).

**Setup**
1. Voeg `firebase-admin` toe: `npm install` (staat al in `package.json`).
2. Maak een service-account aan: Firebase Console → Project settings →
   Service accounts → Generate new private key. Plak de volledige JSON-inhoud
   als één regel in `.env.local` bij `FIREBASE_SERVICE_ACCOUNT_KEY`.
3. Zet minstens één van `ANTHROPIC_API_KEY` of `OPENAI_API_KEY` in
   `.env.local`. Zie `.env.local.example` voor alle opties.
4. Publiceer de bijgewerkte Firestore-regels (zie hierboven) — `chatMessages`
   en `knowledge` zijn read-only voor de client, alleen de server mag
   schrijven.
5. `npm run dev` en open `/dashboard/chat`.

**Bekende beperkingen (bewust, voor snelheid)**
- Eén doorlopend gesprek per gebruiker, geen aparte conversaties/threads.
- De chat gebruikt maximaal de laatste 20 berichten als directe context.
- Second Brain-schrijven is nog ongefilterd; iedere uitwisseling wordt onthouden.
- Retrieval leest maximaal 500 kennisitems; een vector-database is nodig voor grotere schaal.

## Builder-rol via GitHub (Mission Engine V2)

Vanaf nu past de "builder"-rol van Mission Engine V2 daadwerkelijk bestanden
aan in plaats van alleen een tekstueel plan te geven. Dat gebeurt uitsluitend
via de GitHub-repository, nooit door rechtstreeks in de lokale bestanden van
de omgeving te schrijven waar de app op dat moment draait:

1. De Builder leest de actuele bestandsboom en de betrokken bestanden op via
   de GitHub REST API.
2. Een LLM bepaalt de volledige nieuwe inhoud van maximaal 8 bestanden per
   toewijzing.
3. Die wijzigingen worden gecommit op een nieuwe branch
   (`director/mission-<id>-<tijdstip>`) en aangeboden als pull request naar de
   standaardbranch.
4. Er wordt nooit automatisch gemerged — de eigenaar beoordeelt en merget de
   pull request zelf op GitHub.

**Setup**
1. Maak een fine-grained personal access token aan op GitHub, gescoped tot
   alleen de doelrepository, met permissies **Contents: Read and write** en
   **Pull requests: Read and write**.
2. Zet die sleutel in `.env.local` als `GITHUB_BUILDER_TOKEN` (nooit in Git
   committen — zie `.env.local.example`).
3. Optioneel: `GITHUB_BUILDER_REPO_OWNER` / `GITHUB_BUILDER_REPO_NAME` om een
   andere repository te targeten dan `The-Dost-Matrix/the-dost-matrix`
   (bijvoorbeeld een projectrepository).

**Bekende beperking (bewust, voor v0)**: de Director ziet bij zijn
eerstvolgende beslissing nog niet de inhoud van wat de Builder opleverde —
hij ziet alleen dat de toewijzing is afgerond. Daarom bestaat de "qa"-rol
hieronder: die vindt de pull request zelf (via de branchnaam) en beoordeelt
die zelfstandig, in plaats van te vertrouwen op wat de Director erover zou
kunnen navertellen.

## QA-rol via GitHub (Mission Engine V2)

Naast de "builder"-rol bestaat er nu ook een "qa"-rol. Die controleert of
een pull request van de builder-rol daadwerkelijk aan de succescriteria van
de missie voldoet, vóórdat de Director de missie als voltooid mag markeren:

1. QA vindt de pull request die bij de missie hoort via de branchnaam die de
   builder-rol aanmaakt (`director/mission-<id>-...`).
2. Is er geen pull request, of is die nog niet gemerged? Dan faalt de
   QA-toewijzing met een duidelijke reden en blijven de succescriteria
   ongewijzigd — jij moet de pull request dan eerst zelf beoordelen en
   mergen op GitHub.
3. Is de pull request gemerged? Dan beoordeelt een LLM de diff tegen elk
   succescriterium apart en zet dat criterium op PASSED of FAILED.
4. Pas wanneer ALLE succescriteria van een missie op PASSED staan, mag de
   Director de missie voltooien — de Director zelf beoordeelt dit niet meer
   zelfstandig (dat was de vorige, bewust eerlijke beperking van v0).

**Setup**: geen extra stappen — de qa-rol gebruikt dezelfde
`GITHUB_BUILDER_TOKEN` als de builder-rol, met dezelfde permissies
(Contents: read/write, Pull requests: read/write volstaat, QA heeft alleen
leestoegang tot pull requests nodig).

**Bekende beperking (bewust, voor v0)**: QA beoordeelt op basis van de diff
(patches) van de pull request, niet de volledige bestandsinhoud — bij zeer
grote pull requests kan dat onvolledig zijn. Ook is er geen automatische
herbeoordeling wanneer je een afgekeurde pull request later aanpast; de
Director moet dan zelf opnieuw de builder-rol inzetten.

## Volgende sprint

- server-side sessiebeveiliging;
- voice input;
- structured Director-plan;
- Approval Center;
- agent registry uit Firestore;
- een multi-LLM "smart selector" die per taak (Director-beslissingen,
  builder-codegeneratie, QA-beoordeling) automatisch de beste beschikbare
  LLM kiest, plus enkele gratis LLM's met API-koppeling.
