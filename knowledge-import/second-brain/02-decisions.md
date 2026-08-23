# 02-decisions.md — The Dost Matrix Kennisbibliotheek

Bron: the-dost-matrix-development-chat-01.md

---

# DECISION-0001

## Besluit

Stoppen met proberen het project vanuit alleen de chat te bouwen. In plaats daarvan eerst een ontwikkelomgeving bouwen waarin de AI daadwerkelijk productief kan zijn.

## Reden

ChatGPT in de gewone chatvorm kan alleen werken tijdens een actieve sessie en stopt zodra de sessie stopt; het is geen achtergrondwerker. Voor een project als The Dost Matrix is een AI-teamgenoot nodig die uren achter elkaar doorwerkt, zelf test, commits maakt, de volgende taak oppakt en alleen aan de bel trekt bij een echte beslissing.

## Gevolgen

Dit kost eerst tijd (het opzetten van de omgeving), maar daarna neemt de snelheid met een veelvoud toe. Dit wordt gezien als de investering die de meeste tijd gaat besparen.

---

# DECISION-0002

## Besluit

De door Claude gegenereerde V3 (chatsysteem in lokale omgeving + koppeling aan second brain) wordt vanaf nu behandeld als de nieuwe hoofdversie van het project. Er wordt niet opnieuw vanaf V2 begonnen.

## Reden

Claude heeft de V2-zip in één actieve, agentische uitvoering uitgepakt, geanalyseerd, herschreven en teruggegeven als een compleet werkende V3. Dat is wat er nodig was; ChatGPT gaf in plaats daarvan alleen statusberichten.

## Gevolgen

De V3-zip wordt geüpload en volledig geanalyseerd (architectuur, kwaliteit, beveiliging, performance, onderhoudbaarheid, bugs, inconsistenties, technische schuld) voordat er verder op wordt gebouwd. "Volledige V3" betekent niet automatisch dat alles correct, veilig en productiegeschikt is — een gegenereerde versie kan er compleet uitzien maar toch fouten bevatten in bijvoorbeeld authenticatie, databasebeveiliging, synchronisatie, afhankelijkheden of tests.

---

# DECISION-0003

## Besluit

Voor blijvende kennis worden alle eerder gemaakte .md-bestanden geüpload, met uitzondering van een aantal niet-relevante bestanden — in plaats van de huidige mijlpaal.

## Reden

De huidige mijlpaal is niet relevant voor blijvende kennis.

## Gevolgen

Alleen de geselecteerde .md-bestanden worden verwerkt tot kennis in The Dost Matrix.

---

# DECISION-0004

## Besluit

The Dost Matrix (Second Brain) wordt gebouwd als 1 brein met twee hersenhelften, niet als twee aparte breinen.

## Reden

De eerdere benadering (twee aparte hersenhelften bouwen) werd als onjuist bestempeld: "je maakt nu twee aparte hersenhelften, maar wat je moet maken is 1 brein die twee hersenhelften heeft."

## Gevolgen

De architectuur en visuele uitwerking (o.a. gegenereerde afbeeldingen "Verbonden kennis in het tweede brein" en "Futuristic dashboard with holographic brain") worden hierop aangepast. De eigenaar was op dat moment nog niet tevreden met de visuele resultaten ("ik zie eigenlijk niks wat ik mooi vind").

---

# DECISION-0005

## Besluit

Dashboard, chat+second brain en knowledge moeten vanuit 1 interface bruikbaar zijn, in plaats van in aparte vensters.

## Reden

Op het moment van bespreken stonden dashboard, chat+second brain en knowledge nog in aparte vensters in de localhost-omgeving.

## Gevolgen

Er wordt eerst een UI-ontwerp (gebaseerd op een geüploade voorbeeldafbeelding, eventueel aangevuld met een nieuw gegenereerd ontwerp volgens hetzelfde principe) vastgelegd in de second brain, zodat duidelijk is hoe het systeem eruit moet komen te zien.

---

# DECISION-0006

## Besluit

De chunkgrootte voor het archiveren van conversaties wordt tijdelijk verkleind: `CHUNK_LENGTH` van 6000 naar 2500, `CHUNK_OVERLAP` van 800 naar 400 (in `src/core/application/conversation/chunk-service.ts`).

## Reden

De gearchiveerde versie van het bestand `the-dost-matrix-development-chat-01.md` bevatte met de oude chunkgrootte maar 3 chunks voor de betreffende conversatie, waardoor bepaalde stappen (Stap 1 en Stap 2 van de vier expliciet voorgeschreven stappen) nooit konden worden opgehaald door de retrieval.

## Gevolgen

De conversatie moet eenmalig opnieuw verwerkt worden met de kleinere chunks (zie DECISION-0007 en MISSION-0009), waarna de diagnostiek aanzienlijk meer dan 3 chunks zou moeten tonen.

---

# DECISION-0007

## Besluit

Het blok in `src/core/application/conversation/archive-service.ts` dat bestaande chunks hergebruikt wanneer reprocessing niet nodig lijkt, wordt tijdelijk vervangen door een no-op, zodat reprocessing wordt afgedwongen voor bestaande archieven.

## Reden

Oude archieven moeten de nieuwe, kleinere chunkstructuur krijgen; zonder deze tijdelijke aanpassing zou het bestaande (te grove) archief hergebruikt blijven worden.

## Gevolgen

Na deze wijziging moet hetzelfde .md-bestand opnieuw gearchiveerd worden. Dit is een tijdelijke maatregel (in de code als "Tijdelijk opnieuw verwerken" gemarkeerd).

---

# DECISION-0008

## Besluit

In `src/core/application/conversation/retrieval-service.ts` wordt de functie `addNeighbourChunks` volledig vervangen door een nieuwe functie `expandBestConversation`, en `MAX_CONVERSATION_CHUNKS` in `src/core/application/director/director-memory.ts` wordt verhoogd van 8 naar 12.

## Reden

De retrievallogica moest chunks uitbreiden binnen het best scorende gesprek (conversatie) in plaats van simpelweg naburige chunks toe te voegen, en Director moest meer chunks uit een gearchiveerde conversatie kunnen meenemen.

## Gevolgen

Na deze wijziging moet `npm run typecheck` foutloos zijn, en moet de test met de vraag "Welke vier stappen heb ik op 28 juli expliciet voorgeschreven voor de verdere bouw van The Dost Matrix?" opnieuw worden uitgevoerd om te controleren of Stap 1 en Stap 2 nu wél in de selectie terechtkomen.
