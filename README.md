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

De wachtrij- en afgewezen-lijsten op de kennispagina (`subscribeToKnowledgeByStatus`)
filteren op status IN de query, in plaats van pas na het ophalen — anders kon
een oud wachtend kennisitem stilletjes uit het opgehaalde venster vallen
zodra er genoeg nieuwere goedgekeurde items bijkwamen. Dat vraagt een eigen,
samengestelde index:
- Collection: `knowledge`
- Field `ownerId`: Ascending
- Field `status`: Ascending
- Field `createdAt`: Descending

Alle indexen staan al in `firestore.indexes.json` — je hoeft de link uit de
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

## Mission Engine V2

Mission Engine V2 is een nieuwe, zelfstandige implementatie van het
missiesysteem die zonder externe afhankelijkheden werkt. Ze draait naast de
bestaande Mission Engine V1-runtime, zodat beide versies naast elkaar kunnen
functioneren zonder dat bestaande missies of workflows breken. Dankzij deze
opzet blijft de applicatie volledig compatibel met wat er al werkt, terwijl
V2 een moderne, overzichtelijke en onderhoudbare architectuur biedt. Nieuwe
functionaliteit — zoals de Builder- en QA-rollen via GitHub hieronder — wordt
daarom bewust in Mission Engine V2 gebouwd. Op termijn kan V1 worden
uitgefaseerd zodra V2 alle benodigde functionaliteit dekt.

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

De GitHub-authenticatie voor de builder-, qa- en Director-rollen verloopt via
een GitHub App-installatie in plaats van een personal access token. Dat geeft
toegang tot de Checks-API (nodig voor CI-statuscontrole), een permissie die
fine-grained personal access tokens nooit konden krijgen.

1. Maak een GitHub App aan (of gebruik een bestaande), geïnstalleerd op
   alleen de doelrepository, met minstens de permissies **Contents: Read and
   write**, **Pull requests: Read and write** en **Checks: Read-only**.
2. Zet de volgende drie omgevingsvariabelen in `.env.local` (nooit in Git
   committen — zie `.env.local.example`):
   - `GITHUB_APP_ID` — het numerieke App ID van de GitHub App.
   - `GITHUB_APP_INSTALLATION_ID` — het installation ID van de App op de
     doelrepository.
   - `GITHUB_APP_PRIVATE_KEY` — de volledige inhoud van het gedownloade
     `.pem`-privésleutelbestand van de App. Letterlijke `\n`-tekens in de
     omgevingswaarde worden automatisch omgezet naar echte regeleindes, dus
     zowel een meerregelige waarde als een one-liner met `\n` werkt.
3. Optioneel: `GITHUB_BUILDER_REPO_OWNER` / `GITHUB_BUILDER_REPO_NAME` om een
   andere repository te targeten dan `The-Dost-Matrix/the-dost-matrix`
   (bijvoorbeeld een projectrepository). De GitHub App moet dan wél op die
   repository geïnstalleerd zijn.

Intern wisselt `github-client.ts` deze gegevens zelf in voor een kortlevende
installation access token (geldig 1 uur): er wordt met Node's ingebouwde
`crypto`-module een RS256 JWT ondertekend en die JWT wordt bij GitHub
ingewisseld voor het installation-token. Dat token wordt in-memory gecachet
en pas kort vóór het verlopen automatisch ververst — er wordt dus niet bij
elke aanroep opnieuw geauthenticeerd.

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
5. Vóórdat QA een criterium op GEHAALD zet, probeert ze eerst mechanisch
   (niet via de LLM) de GitHub-CI-status van die pull request op te vragen —
   bij een falende check worden ALLE succescriteria hard op NIET GEHAALD
   gezet, ongeacht wat de LLM inhoudelijk beoordeelt; bij nog lopende checks
   wordt het oordeel uitgesteld. Dezelfde controle voert de Director
   nogmaals uit vlak vóór het (eventueel automatisch) mergen, als tweede,
   onafhankelijke verdedigingslaag.

**Setup**: de qa-rol en de Director gebruiken dezelfde GitHub App-installatie
(zie "Builder-rol via GitHub" hierboven voor de setup van `GITHUB_APP_ID`,
`GITHUB_APP_INSTALLATION_ID` en `GITHUB_APP_PRIVATE_KEY`).

De eerder bekende beperking rond de CI-statuscontrole is met deze
App-authenticatie opgelost: GitHub stond de daarvoor benodigde
"Checks"-permissie niet toe op fine-grained personal access tokens
(bevestigd door GitHub Support: "only GitHub Apps can access this API"), maar
een GitHub App-installatie kan die permissie wél krijgen. `getCombinedCheckStatus`
(zie github-client.ts) haalt de CI-status nu daadwerkelijk op via de
Checks-API, en QA en de Director gebruiken die status als harde gate zoals
hierboven beschreven.

**Bekende beperking (bewust, voor v0)**: QA beoordeelt op basis van de diff
(patches) van de pull request, niet de volledige bestandsinhoud — bij zeer
grote pull requests kan dat onvolledig zijn. Ook is er geen automatische
herbeoordeling wanneer je een afgekeurde pull request later aanpast; de
Director moet dan zelf opnieuw de builder-rol inzetten.

## Wat betekent NIET VAST TE STELLEN?

Soms kan QA een succescriterium niet eerlijk nakijken. Dat gebeurt als het
antwoord niet objectief uit de code, de bestanden of de pull request te halen
is — de pull request is het voorstel met wijzigingen dat jij zelf bekijkt en
goedkeurt. Denk aan criteria over smaak, over of een tekst lekker leest, of
over de vraag of iets "goed genoeg voelt" voor jou. Dat kan alleen jij
beoordelen.

In zo'n geval gebeurt dit:

1. QA zet dat criterium op **NIET VAST TE STELLEN**. Het criterium krijgt dus
   géén PASSED (gehaald) en géén FAILED (niet gehaald).
2. De Director rondt de missie dan niet af. In plaats daarvan stelt hij jou
   (Elroy) een concrete vraag en wacht op je beslissing.
3. Jij geeft het oordeel. Je hebt drie keuzes: goedkeuren, afkeuren met een
   korte toelichting over wat er anders moet, of het criterium aanpassen of
   helemaal laten vervallen.
4. Daarna gaat de Director verder met de missie, op basis van wat jij hebt
   besloten.

Zo blijft een smaakvraag altijd bij jou liggen, en doet QA nooit alsof ze iets
heeft gecontroleerd wat ze niet kan controleren.

## Volgende sprint

- server-side sessiebeveiliging;
- voice input;
- structured Director-plan;
- Approval Center;
- agent registry uit Firestore;
- een multi-LLM "smart selector" die per taak (Director-beslissingen,
  builder-codegeneratie, QA-beoordeling) automatisch de beste beschikbare
  LLM kiest, plus enkele gratis LLM's met API-koppeling.

## FAQ

**Wat is The Dost Matrix?**
The Dost Matrix is een persoonlijk AI-besturingssysteem, gebouwd op Next.js
en Firebase, waarin missies, een Second Brain-kennisbank en autonome rollen
(zoals Director, Builder en QA) samenkomen om werk te plannen, uit te voeren
en te controleren.

**Hoe draag ik bij aan dit project?**
Volg de installatiestappen hierboven om de app lokaal te draaien, maak je
wijzigingen op een aparte branch en open een pull request. De eigenaar
beoordeelt en merget pull requests zelf; er wordt nooit automatisch
gemerged.

**Welke LLM-providers ondersteunt de chat?**
De chatfunctionaliteit ondersteunt zowel Anthropic als OpenAI. De Model
Router kiest automatisch Anthropic als `ANTHROPIC_API_KEY` is ingesteld, en
valt anders terug op OpenAI.

**Waarom bestaan Mission Engine V1 en V2 naast elkaar?**
Mission Engine V2 is een nieuwe, zelfstandige implementatie die zonder
externe afhankelijkheden werkt. Ze draait bewust naast V1, zodat bestaande
missies en workflows niet breken terwijl nieuwe functionaliteit (zoals de
Builder- en QA-rollen) in de modernere V2-architectuur wordt gebouwd.

## QA

Pre-merge QA test
