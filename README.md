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

## Volgende sprint

- server-side sessiebeveiliging;
- voice input;
- structured Director-plan;
- Approval Center;
- agent registry uit Firestore;
- GitHub-previewworkflow.
