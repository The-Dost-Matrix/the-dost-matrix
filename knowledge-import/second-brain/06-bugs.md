# 06-bugs.md — The Dost Matrix Kennisbibliotheek

Bron: the-dost-matrix-development-chat-01.md

---

# BUG-0001

Probleem: onduidelijk of/waar `FIREBASE_SERVICE_ACCOUNT_FILE=C:/Users/Elroy/Downloads/jouw-service-account-bestand.json` ingesteld moet worden.

Oorzaak: er is geen `.env.local` bestand aanwezig.

Oplossing: niet vermeld in de conversatie.

Status: Open

---

# BUG-0002

Probleem: het opslaan van een bepaalde actie heeft de werkende versie v0.3.1 overschreven ("je hebt me nu dit laten opslaan en daarmee hebben we de werkende versie van v0.3.1 overschreven!").

Oorzaak: niet expliciet vastgesteld in de conversatie.

Oplossing: de eigenaar heeft in Downloads de laatste versie van v0.3.1 teruggezet.

Status: Bezig (na het terugzetten treedt een nieuwe foutmelding op, zie BUG-0003)

---

# BUG-0003

Probleem: na het terugzetten van v0.3.1 geeft het systeem een foutmelding; daarnaast blijkt de "knowledge"-functionaliteit (onverwacht) wel te werken.

Oorzaak: onbekend ("hoe weet ik niet!").

Oplossing: niet vermeld; een schermafbeelding zou volgen.

Status: Open

---

# BUG-0004

Probleem: de volgende dag ("donderdag") doet "knowledge" het niet meer.

Oorzaak: niet vermeld.

Oplossing: niet vermeld.

Status: Open

---

# BUG-0005

Probleem: er staat geen title (ontbrekende titel, gemeld op "donderdag 17:03").

Oorzaak: niet vermeld.

Oplossing: niet vermeld.

Status: Open

---

# BUG-0006

Probleem: het losse bestand kan niet geüpload worden.

Oorzaak: niet vermeld.

Oplossing: niet vermeld.

Status: Open

---

# BUG-0007

Probleem: bij `knowledgeEntry` ontbreekt het veld `approvedAt`, terwijl de `KnowledgeReview`-interface wel `reviewedAt` bevat.

Oorzaak: veld niet toegevoegd aan het domeinmodel.

Oplossing: niet expliciet vastgesteld in de conversatie (wel worden `KnowledgeReviewRecommendation` en `KnowledgeReview` als definities toegevoegd, zie CODE-0002).

Status: Open

---

# BUG-0008

Probleem: geen bestanden meer zichtbaar rechts in de interface; daar stond eerst de volledige mappenstructuur.

Oorzaak: niet vermeld.

Oplossing: niet vermeld.

Status: Open

---

# BUG-0009

Probleem: het laatst geüploade item is niet terug te vinden in de middelste kolom; bij "documents" van de laatste upload staat in de rechterkolom `knowledgeItems: 0`.

Oorzaak: niet vermeld.

Oplossing: gewenst gedrag geformuleerd als vereiste: laatst toegevoegde items bovenaan tonen (zie REQUIREMENT-0002).

Status: Open

---

# BUG-0010

Probleem: na het (opnieuw) opstarten van het systeem treedt een fout op, zonder dat de eigenaar iets heeft gedaan ("ik heb nog niets gedaan maar ik krijg wel dit nadat ik weer opnieuw aan het opstarten ben").

Oorzaak: niet vermeld.

Oplossing: niet vermeld.

Status: Open

---

# BUG-0011

Probleem: het bestand/de map `components` bestaat nog niet.

Oorzaak: nog niet aangemaakt.

Oplossing: alles opnieuw aanmaken op basis van een eerder bericht ("components bestaat nog niet, dus ik ga nu alles maken uit je eerdere bericht, daarna stuur ik klaar").

Status: Bezig

---

# BUG-0012

Probleem: de topbar klopt niet ("de topbar klopt ook niet volgens mij").

Oorzaak: niet vermeld.

Oplossing: niet vermeld.

Status: Open

---

# BUG-0013

Probleem: `src/core/domain/knowledge/knowledge-entry.ts` bestaat nog niet, terwijl er wel al code (via "Geplakte code(4).ts") naar dit bestand verwijst.

Oorzaak: bestand nog niet aangemaakt.

Oplossing: niet vermeld.

Status: Open

---

# BUG-0014

Probleem: van alles wat in de chat is besproken, levert The Dost Matrix maar 8 items op om te beoordelen ("dus van alles wat we hier in deze chat hebben besproken komt The Dost Matrix maar met 8 items om te beoordelen. Dat kan toch niet goed zijn").

Oorzaak: gerelateerd aan retrieval/chunking-beperkingen van de conversatie-archivering (zie BUG-0015 voor de nader onderzochte, verwante retrievalbug).

Oplossing: niet direct vermeld bij dit specifieke punt.

Status: Open

---

# BUG-0015

Probleem: op de testvraag "Welke vier stappen heb ik op 28 juli expliciet voorgeschreven voor de verdere bouw van The Dost Matrix?" mist Director Stap 1 en Stap 2 van de vier stappen.

Oorzaak: de gearchiveerde versie van het bestand `the-dost-matrix-development-chat-01.md` bevat met de toenmalige instellingen maar 3 chunks voor deze conversatie (`conversationChunkCount: 3`, `knowledgeCount: 12`, `archiveContextLength: 13701`). Daardoor kunnen Stap 1 en Stap 2 nooit worden opgehaald, omdat ze niet voorkomen in de opgeslagen chunkset van `conversationId: 57ANkjRAGR5OaNFwSsss` (zie het volledige diagnostics-blok in CODE-0008).

Oplossing:
1. `CHUNK_LENGTH` verkleind van 6000 naar 2500 en `CHUNK_OVERLAP` van 800 naar 400 in `chunk-service.ts`.
2. Reprocessing van bestaande archieven tijdelijk afgedwongen in `archive-service.ts`.
3. `addNeighbourChunks` vervangen door `expandBestConversation` in `retrieval-service.ts`.
4. `MAX_CONVERSATION_CHUNKS` verhoogd van 8 naar 12 in `director-memory.ts`.
5. Het bestand opnieuw archiveren en de testvraag opnieuw stellen.

Status: Bezig (code-wijzigingen doorgevoerd, `npm run typecheck` gaf geen fouten; het herteste resultaat na herarchivering wordt in deze conversatie niet meer getoond)
