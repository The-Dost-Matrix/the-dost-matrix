# 10-index.md — The Dost Matrix Kennisbibliotheek

Bron: the-dost-matrix-development-chat-01.md

Volledige index van alle kennisitems.

---

## Missions → 01-missions.md

MISSION-0001 — Ontwikkelomgeving bouwen zodat de AI grotere, langere taken kan uitvoeren
MISSION-0002 — V2-zip laten verwerken tot V3 en als nieuwe hoofdversie gebruiken
MISSION-0003 — FIREBASE_SERVICE_ACCOUNT_FILE correct configureren
MISSION-0004 — Alleen eerder gemaakte .md-bestanden uploaden voor blijvende kennis
MISSION-0005 — Definities toevoegen: KnowledgeReviewRecommendation en KnowledgeReview
MISSION-0006 — Bestand maken om UI-ontwerp te uploaden naar second brain + 1 interface
MISSION-0007 — Second Brain herontwerpen als 1 brein met twee hersenhelften
MISSION-0008 — Chatvenster-lay-out aanpassen: invoerveld groter en boven het gesprek
MISSION-0009 — Retrieval van archiefconversaties verbeteren (chunking + expandBestConversation)

## Decisions → 02-decisions.md

DECISION-0001 — Eerst ontwikkelomgeving bouwen i.p.v. alleen vanuit de chat werken
DECISION-0002 — V3 van Claude wordt nieuwe hoofdversie van het project
DECISION-0003 — Alle eerdere .md-bestanden uploaden i.p.v. huidige mijlpaal
DECISION-0004 — Second Brain wordt 1 brein met twee hersenhelften
DECISION-0005 — Dashboard, chat+second brain en knowledge vanuit 1 interface
DECISION-0006 — Chunkgrootte verkleind (CHUNK_LENGTH/CHUNK_OVERLAP)
DECISION-0007 — Reprocessing tijdelijk afgedwongen in archive-service.ts
DECISION-0008 — addNeighbourChunks vervangen door expandBestConversation + MAX_CONVERSATION_CHUNKS 8→12

## Requirements → 03-requirements.md

REQUIREMENT-0001 — Alles vanuit 1 interface bruikbaar
REQUIREMENT-0002 — Laatst toegevoegde items bovenaan
REQUIREMENT-0003 — Chatinvoerveld groter en boven het gesprek
REQUIREMENT-0004 — Second Brain als 1 brein met twee hersenhelften
REQUIREMENT-0005 — UI moet overeenkomen met afgesproken ontwerp
REQUIREMENT-0006 — Director moet alle voorgeschreven stappen uit een gesprek terugvinden

## Architecture → 04-architecture.md

ARCH-0001 — Drie niveaus van AI-werkmodel voor ontwikkeling
ARCH-0002 — Second Brain: 1 brein met twee hersenhelften
ARCH-0003 — Interface-eenheid (dashboard, chat+second brain, knowledge)
ARCH-0004 — Genoemde bestanden/modules in de codebase
ARCH-0005 — Diagnostics/retrieval-datamodel (Command Center)

## Code → 05-code.md

CODE-0001 — codebase-scanner.ts (CodebaseFile, CodebaseSnapshot, exclusielijsten)
CODE-0002 — KnowledgeReviewRecommendation / KnowledgeReview
CODE-0003 — codebase-tree contextinstructie + npm run typecheck
CODE-0004 — expandBestConversation (vervangt addNeighbourChunks) + aanroep
CODE-0005 — chunk-service.ts: CHUNK_LENGTH/CHUNK_OVERLAP
CODE-0006 — archive-service.ts: reprocessing tijdelijk afgedwongen
CODE-0007 — director-memory.ts: MAX_CONVERSATION_CHUNKS 8→12
CODE-0008 — Testvraag + volledige diagnostics-uitvoer
CODE-0009 — Overzicht terminalcommando's (npm run typecheck)

## Bugs → 06-bugs.md

BUG-0001 — FIREBASE_SERVICE_ACCOUNT_FILE: onduidelijk waar in te stellen
BUG-0002 — Werkende v0.3.1 overschreven bij opslaan
BUG-0003 — Foutmelding na terugzetten v0.3.1; knowledge werkt onverklaarbaar
BUG-0004 — Knowledge werkt de volgende dag niet meer
BUG-0005 — Geen title aanwezig
BUG-0006 — Los bestand kan niet geüpload worden
BUG-0007 — approvedAt ontbreekt bij knowledgeEntry
BUG-0008 — Geen bestanden/mappenstructuur meer zichtbaar rechts
BUG-0009 — Laatste upload niet vindbaar; knowledgeItems: 0
BUG-0010 — Foutmelding na herstart zonder gebruikersactie
BUG-0011 — components bestaat nog niet
BUG-0012 — Topbar klopt niet
BUG-0013 — knowledge-entry.ts bestaat nog niet
BUG-0014 — Slechts 8 items om te beoordelen ondanks uitgebreide chat
BUG-0015 — Director mist Stap 1 en Stap 2 door te weinig chunks (kernbug, met fix)

## Roadmap → 07-roadmap.md

ROADMAP-0001 — Ontwikkelomgeving met GitHub/Codex/CI-CD (korte termijn)
ROADMAP-0002 — Autonome AI-ontwikkelaar op server (lange termijn)
ROADMAP-0003 — Interface unificeren (middellange termijn)
ROADMAP-0004 — Second Brain herontwerpen als 1 brein (middellange termijn)
ROADMAP-0005 — Retrieval/chunking verder verbeteren (korte termijn)

## Business → 08-business.md

Geen BUSINESS-items in deze conversatie (uitsluitend technische inhoud).

## Personal context → 09-personal-context.md

PERSON-0001 — Naam "Elroy" (uit bestandspad)
PERSON-0002 — Werkt aan The Dost Matrix (AI operating system)
PERSON-0003 — Gebruikt zowel ChatGPT als Claude AI
PERSON-0004 — Directe, kritische communicatiestijl
PERSON-0005 — Windows-werkomgeving, lokale ontwikkelomgeving (localhost)
