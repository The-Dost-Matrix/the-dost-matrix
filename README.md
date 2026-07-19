# The Dost Matrix v0.2

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
firebase deploy --only firestore:rules
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

## Volgende sprint

- server-side sessiebeveiliging;
- voice input;
- structured Director-plan;
- Approval Center;
- agent registry uit Firestore;
- GitHub-previewworkflow.
