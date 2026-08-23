# 01-missions.md — The Dost Matrix Kennisbibliotheek

Bron: the-dost-matrix-development-chat-01.md

---

# MISSION-0001

Ontwikkelomgeving bouwen zodat de AI grotere, langere taken kan uitvoeren

## Doel

Een werkwijze/omgeving creëren waarin de AI niet elke paar minuten een nieuwe prompt nodig heeft, maar zelfstandig binnen een sessie (en op termijn autonoom) kan testen, commits kan maken en de volgende taak kan oppakken, en alleen aan de bel trekt wanneer een echte beslissing nodig is.

## Opdracht

Overstappen van "ChatGPT zoals nu" (alleen actief tijdens een sessie, geen achtergrondwerker) naar minimaal niveau 2: ChatGPT/AI gekoppeld aan een ontwikkelomgeving (GitHub, Codex/CLI, CI/CD, tests, enz.), zodat binnen die omgeving grotere taken in één keer uitgevoerd kunnen worden. Op termijn niveau 3: een autonome AI-ontwikkelaar die op een server draait, taken uit een backlog pakt, code schrijft, test, commits maakt, waarbij de eigenaar alleen nog reviews doet.

## Status

Open

---

# MISSION-0002

V2-zip laten verwerken tot een volledige V3 (chatsysteem in lokale omgeving + koppeling aan second brain) en deze als nieuwe hoofdversie gebruiken

## Doel

Een werkende, volledige versie (V3) van The Dost Matrix verkrijgen met een chatsysteem in een eigen lokale omgeving, gekoppeld aan een second brain.

## Opdracht

De V3-zip (gegenereerd door Claude AI na verwerking van de v2-zip) uploaden zodat deze:
1. volledig uitgepakt wordt,
2. de projectstructuur en bestaande functionaliteit geanalyseerd wordt,
3. gecontroleerd wordt op architectuur, kwaliteit, beveiliging, performance en onderhoudbaarheid,
4. gecontroleerd wordt op bugs, inconsistenties en technische schuld,
5. als nieuwe hoofdversie gebruikt wordt om op verder te bouwen (in plaats van opnieuw vanaf V2 te beginnen).

## Status

Gereed (besluit genomen en zip is geüpload — zie DECISION-0002 en vervolg in de chat met versie v0.3/v0.3.1)

---

# MISSION-0003

FIREBASE_SERVICE_ACCOUNT_FILE correct configureren

## Doel

Het pad naar het Firebase service account bestand correct beschikbaar maken voor de applicatie.

## Opdracht

Vaststellen of `FIREBASE_SERVICE_ACCOUNT_FILE=C:/Users/Elroy/Downloads/jouw-service-account-bestand.json` ingesteld moet worden, en in welk bestand — er is geconstateerd dat er geen `.env.local` bestand aanwezig is.

## Status

Open (zie BUG-0001)

---

# MISSION-0004

Alleen de eerder gemaakte .md-bestanden uploaden voor blijvende kennis (i.p.v. de huidige mijlpaal)

## Doel

Alleen daadwerkelijk blijvende/relevante kennis in de knowledge base van The Dost Matrix opnemen.

## Opdracht

Alle eerder gemaakte .md-bestanden uploaden, met uitzondering van een aantal niet-relevante bestanden. De huidige mijlpaal wordt niet geüpload omdat deze niet relevant is voor blijvende kennis.

## Status

Bezig

---

# MISSION-0005

Definities toevoegen aan knowledge-domeinmodel: `KnowledgeReviewRecommendation` en `KnowledgeReview`

## Doel

Het datamodel voor knowledge-reviews uitbreiden.

## Opdracht

Vanaf regel 6 de volgende definities toevoegen:

```ts
export type KnowledgeReviewRecommendation = 
  | "approve"
  | "edit"
  | "reject";

export interface KnowledgeReview {
  recommendation: KnowledgeReviewRecommendation;
  confidence: number;
  reason: string;
  issues: string[];
  suggestedTitle?: string;
  suggestedContent?: string;
  reviewedAt: Date | null;
  model: string;
}
```

Geconstateerd: dit staat al bij `knowledgeEntry`, maar het veld `approvedAt` ontbreekt daar (zie BUG-0007).

## Status

Bezig

---

# MISSION-0006

Bestand maken waarmee het UI-ontwerp geüpload kan worden naar de second brain, en alles vanuit 1 interface bruikbaar maken

## Doel

Vroeg in het project al vastleggen hoe de uiteindelijke UI eruit moet zien, en de gebruikerservaring unificeren.

## Opdracht

- Eerst een bestand maken waarin het ontwerp van de UI uit de geüploade afbeelding geüpload kan worden naar de second brain van The Dost Matrix, zodat duidelijk is hoe het systeem er uiteindelijk uit moet zien.
- Eventueel een nieuwe afbeelding genereren die beter aansluit bij de doelstelling, maar wel volgens hetzelfde principe als de voorbeeldafbeelding.
- Ervoor zorgen dat alles vanuit 1 interface te gebruiken is — op dat moment staan dashboard, chat+second brain en knowledge nog in aparte vensters in de localhost-omgeving.

## Status

Bezig

---

# MISSION-0007

Second Brain herontwerpen als 1 brein met twee hersenhelften

## Doel

De juiste conceptuele benadering hanteren voor de Second Brain-architectuur.

## Opdracht

In plaats van twee aparte hersenhelften (breinen) te bouwen, één brein bouwen dat twee hersenhelften heeft.

## Status

Bezig

---

# MISSION-0008

Chatvenster-lay-out aanpassen: invoerveld groter en boven het gesprek

## Doel

Bruikbaarheid van de chatinterface verbeteren.

## Opdracht

Het invoerveld van de chat groter maken en boven het chatgesprek plaatsen (in plaats van eronder), zodat niet naar beneden gescrold hoeft te worden om iets in te voeren.

## Status

Open

---

# MISSION-0009

Retrieval van archiefconversaties verbeteren zodat Director alle expliciet voorgeschreven stappen kan terugvinden

## Doel

Voorkomen dat Director (het orkestrerende AI-onderdeel) belangrijke instructies/stappen uit een lang, gearchiveerd gesprek mist.

## Opdracht

1. In `src/core/application/conversation/chunk-service.ts`: `CHUNK_LENGTH` van `6000` naar `2500` en `CHUNK_OVERLAP` van `800` naar `400` aanpassen.
2. In `src/core/application/conversation/archive-service.ts`: het blok dat bestaande chunks hergebruikt bij een niet-gewijzigde fingerprint, tijdelijk vervangen door een no-op, zodat reprocessing wordt afgedwongen.
3. `npm run typecheck` uitvoeren en alleen de uitkomst terugsturen.
4. Hetzelfde .md-bestand opnieuw archiveren.
5. In `src/core/application/conversation/retrieval-service.ts`: de functie `addNeighbourChunks` volledig verwijderen en vervangen door `expandBestConversation` (zie 05-code.md), en de aanroep onderaan van `addNeighbourChunks(ranked, chunks, maximumResults)` vervangen door `expandBestConversation(ranked, chunks, maximumResults)`.
6. In `src/core/application/director/director-memory.ts`: `MAX_CONVERSATION_CHUNKS` van `8` naar `12` aanpassen.
7. `npm run typecheck` opnieuw uitvoeren en alleen de uitkomst terugsturen.
8. Opnieuw naar Command Center gaan en exact dezelfde vraag stellen: "Welke vier stappen heb ik op 28 juli expliciet voorgeschreven voor de verdere bouw van The Dost Matrix?"
9. Het volledige antwoord van Director en het volledige nieuwe diagnostics-blok uit de terminal terugsturen.

## Status

Bezig (typecheck gaf "geen fouten"; resultaat van de hertest met de nieuwe chunkgrootte en de expandBestConversation-functie is in deze conversatie nog niet bevestigd)
