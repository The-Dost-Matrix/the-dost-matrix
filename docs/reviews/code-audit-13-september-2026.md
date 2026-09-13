# Oordeel over de externe code-audit van 13 september 2026

**Bron van de audit:** "The Dost Matrix — Technische Review & Optimalisatieplan",
opgesteld door ChatGPT op verzoek van Elroy, op basis van een zip van de
projectcode. 25 bevindingen (F-01 t/m F-25), gericht op de Knowledge
Foundation.

**Wat dit document is:** het antwoord daarop. Per bevinding: klopt hij, en zo
ja, wat is er mee gedaan. Elroy heeft expliciet gevraagd om onderbouwing bij
alles waar ik het niet mee eens ben — dat staat in hoofdstuk 4.

**Hoe er is geverifieerd:** elke bevinding is nagelopen tegen de werkelijke
broncode op de live repo, niet tegen de beschrijving in het reviewdocument.
Dat is niet vanzelfsprekend: een audit op een zip kan verouderd zijn, en een
bevinding kan een bewuste, elders gedocumenteerde keuze beschrijven alsof het
een fout is. Waar het reviewdocument een bestand of regel noemt, is dat
bestand zelf gelezen.

**Uitkomst van die verificatie, eerlijk gezegd: de feitelijke claims kloppen.**
Elke bewering die ik kon natrekken — het lege `if`-blok, de byte-identieke
reviewer-bestanden, de ontbrekende parser-dependencies in `package.json`, de
niet-herberekende fingerprint — bleek waar. Ik had zelf één vermoeden dat de
audit ernaast zat (dat `docs/architecture-v2/` niet zou bestaan); dat vermoeden
was fout, de map bestaat wel. De meningsverschillen hieronder gaan dus niet
over de feiten, maar over hoe zwaar ze wegen en wat eraan gedaan moet worden.

---

## 1. Samenvatting

| Categorie | Aantal | Bevindingen |
|---|---|---|
| Eens, nu gerepareerd | 6 | F-03, F-06, F-07, F-09, F-16, F-21 |
| Eens, hoort als roadmapstap | 9 | F-01, F-02, F-04, F-05, F-10, F-12, F-17, F-18, F-19 |
| Eens met de waarneming, oneens met de urgentie | 4 | F-11, F-14, F-15, F-25 |
| Oneens | 5 | F-13, F-20, F-22, F-23, F-24 |
| Deels | 1 | F-08 |

---

## 2. Eens, en nu gerepareerd

Dit zijn de zes bevindingen die echte, stille fouten beschreven: gedrag dat
niet doet wat het lijkt te doen, met gevolgen die niemand ziet. Precies het
soort fout waarvoor een blik van buiten nuttig is.

### F-16 — Duplicaatcontrole in Conversation Archive deed niets

De beste vondst van de hele audit. In `archive-service.ts` stond een
duplicaatcontrole die correct zocht, correct vergeleek, en vervolgens een leeg
`if`-blok binnenging met alleen een commentaarregel erin: *"Tijdelijk opnieuw
verwerken zodat oude archieven de nieuwe, kleinere chunkstructuur krijgen."*
Die eenmalige herverwerking was allang gebeurd. Wat overbleef was een gesprek
dat bij élke import opnieuw volledig werd weggeschreven — inclusief alle chunks
en alle betaalde embeddings.

Bij het repareren bleek er nog iets: de functie `shouldReprocessConversation`
die in dat blok werd aangeroepen, vergeleek de fingerprint van het gevonden
gesprek met de fingerprint waarop het gevonden wás. Die twee zijn per definitie
gelijk. De functie zag eruit als een inhoudelijke afweging, maar vergeleek een
waarde met zichzelf. Dat is gevaarlijker dan geen controle, want een latere
lezer gaat ervan uit dat er iets wordt afgewogen.

**Gedaan:** de short-circuit werkt weer en geeft het bestaande gesprek terug
zonder iets te schrijven. De tijdelijke herverwerking is nu een expliciete
`forceReprocess`-optie, zodat hij opnieuw kan wanneer de chunkstructuur écht
verandert — maar alleen als de aanroeper erom vraagt.
`shouldReprocessConversation` is verwijderd, met een toelichting op zijn plek.
Vier tests leggen het herstelde gedrag vast.

### F-07 — Bewerken liet fingerprint en embedding verouderen

`updateKnowledgeEntry` schreef `...updates` rechtstreeks naar Firestore.
Bewerkte je via het beoordelingsscherm de inhoud van een kennisitem, dan bleven
`fingerprint` en `embedding` van de oude tekst staan. Twee stille gevolgen:
deduplicatie vergeleek daarna nog op de oude tekst, en semantische retrieval
haalde het item op grond van tekst die er niet meer stond. Het item kwam dus
boven bij de verkeerde vragen en bleef weg bij de juiste — zonder dat er ooit
een foutmelding verscheen.

**Gedaan:** de fingerprint wordt herberekend zodra type, titel of inhoud
wijzigt. De embedding niet daar — dat vereist een providercall, en een
repository die zelf een LLM aanroept doorbreekt de laagscheiding die dit
project verder wel aanhoudt. De reviewroute levert hem aan.

Eén afweging is expliciet gemaakt: levert de aanroeper géén verse embedding
terwijl de tekst wel wijzigt, dan wordt de oude **gewist** in plaats van
bewaard. Een leeg embedding-veld laat `cosineSimilarity` op 0 uitkomen,
waardoor het item alleen nog op trefwoorden meedoet — minder scherp, maar wél
over de tekst die er werkelijk staat. Een verouderde embedding laten staan
geeft zelfverzekerd verkeerde treffers, en dat is in een kennissysteem de
duurdere van de twee.

Bewust níet toegevoegd: een duplicaatcontrole op de nieuwe fingerprint. Een
bewerking die toevallig samenvalt met een bestaand item zou dan geweigerd of
stil samengevoegd moeten worden, en allebei zijn erger dan het probleem — je
zit op dat moment in het beoordelingsscherm en krijgt je eigen wijziging niet
opgeslagen.

### F-06 — Deduplicatie gooide de tweede bron weg

`createKnowledgeEntry` gaf bij een duplicaat het bestaande id terug en deed
verder niets. Onderbouwden twee onafhankelijke documenten dezelfde claim, dan
bleef alleen de eerste bron zichtbaar. Het systeem verloor bewijskracht zonder
spoor.

**Gedaan:** een duplicaat verrijkt nu de provenance in plaats van te
verdwijnen. Kennisitems hebben een `sourceReferences`-lijst; een tweede bron
wordt eraan toegevoegd. Bestaande Firestore-documenten hoeven niet gemigreerd:
de lezer valt terug op het oude enkelvoudige `sourceReference`-veld en behandelt
dat als een lijst van één.

Dit is bewust de kleine versie van wat de audit voorstelt (een volledige
scheiding van `Claim` en `Evidence` als aparte domeinobjecten). De winst
daarvan — geen bron meer kwijtraken — zit hier al in. De rest van die
scheiding is re-architectuur; zie hoofdstuk 4.

### F-09 — Importtellingen telden duplicaten mee als nieuw

Omdat `createKnowledgeEntry` bij een duplicaat gewoon een id teruggaf, telde de
importroute dat mee als geïmporteerd. Twee keer hetzelfde document importeren
meldde opnieuw "8 kennisitems staan klaar voor beoordeling" terwijl er nul
waren bijgekomen. Hetzelfde getal werd als `knowledgeItems` op het document
gezet.

**Gedaan:** `createKnowledgeEntry` geeft nu `{ id, created, evidenceAdded }`
terug. De importroute telt nieuw, gededupliceerd en bewijs-verrijkt apart en
rapporteert ze los.

### F-03 — Het scherm meldde verwerking die niet plaatsvond

De Knowledge-pagina meldde "*N* bestanden zijn verwerkt" voor élk bestand dat
de uploadroute accepteerde — ook voor PDF, DOCX, XLSX en afbeeldingen, waarvan
alleen metadata wordt vastgelegd en de inhoud nooit gelezen. Voor een systeem
dat beslissingen op zijn eigen kennis baseert is dat het duurste soort
onwaarheid: je denkt iets te weten wat er nooit in is gezet.

**Gedaan:** de melding scheidt nu geregistreerd van inhoudelijk gelezen, noemt
de bestanden die alleen zijn vastgelegd bij naam, en zegt er expliciet bij dat
de Second Brain hun inhoud nog niet kan gebruiken. De archiefmelding zegt niet
langer "volledig opgeslagen" wanneer het gesprek er al in stond.

Dit is de goedkoopste van de zes reparaties en waarschijnlijk de belangrijkste:
zolang F-01 niet gebouwd is, is eerlijk zijn over wat er níet gebeurt het enige
dat het vertrouwen in de rest overeind houdt.

### F-21 — Twee identieke reviewer-bestanden

`src/domains/knowledge/reviewer.ts` en
`src/core/application/knowledge/reviewer.ts` zijn byte-identiek. Nagetrokken:
alleen de tweede wordt geïmporteerd (door `api/knowledge/review/route.ts`) en
alleen die heeft een testbestand. De eerste is dode code.

**Gedaan:** aangemerkt voor verwijdering via `git rm`. Vangnet: als er tóch
ergens een import naar wijst die ik niet heb gezien, faalt `npx tsc --noEmit`
onmiddellijk en luidruchtig — dat is precies het soort fout dat niet stil kan
blijven.

---

## 3. Eens, maar dit hoort een roadmapstap te zijn

Deze bevindingen kloppen en zijn de moeite waard. Ze zijn alleen te groot om
als bijvangst van een audit even mee te nemen, en ze horen thuis in de manier
waarop dit project werkt: als missie met een pull request en jouw goedkeuring,
niet als een stille grote wijziging.

### F-01, F-02, F-04, F-05 — Documentverwerking (samen één stap)

De kern van de audit, en terecht: PDF, DOCX, XLSX en afbeeldingen worden
geaccepteerd maar nooit gelezen, er is geen server-side opslag van de originele
bytes, kennisextractie is hardcoded op `.md`, en er is geen bronhash of
versiebeheer op documentniveau. `package.json` bevat inderdaad geen enkele
parserbibliotheek — geverifieerd.

Dit is geen defect maar een **ontbrekende capaciteit**, en dat onderscheid
bepaalt de aanpak. Er gaat niets kapot; er is iets niet gebouwd. De reparatie
is een echte bouwstap: bytes opslaan, adapters per formaat, een canoniek
geparsed model, en pas dan extractie die niet meer naar een bestandsextensie
kijkt.

Aanbeveling: één roadmapstap, in deze volgorde gebouwd, waarbij de UI pas een
bestandstype aanbiedt zodra de backend het werkelijk leest. Tot die tijd doet
de eerlijke melding uit F-03 het werk.

### F-10 — Eén LLM-call per document

Klopt: het hele document gaat in één prompt, en de output wordt afgekapt op 150
items. Bij grote documenten worden secties overgeslagen zonder dat iemand het
merkt. Gestructureerde chunking is het juiste antwoord.

Met één uitzondering — zie hoofdstuk 4 over de voorgestelde acceptatie-eis om
de 120.000-tekengrens helemaal te schrappen.

### F-12 — Provenance is te dun

Klopt. Een kennisitem bewaart bronbestand en sectie, maar niet met welke
parser, welk model, welke promptversie of welk exact fragment het is ontstaan.
Zonder dat kun je na een verbetering aan de extractie niet bepalen welke oude
items opnieuw verwerkt moeten worden.

Dit hoort samen met F-01 gebouwd te worden, niet los: provenance die naar
chunks verwijst heeft pas betekenis zodra er chunks zijn.

### F-17, F-18 — Chunking en embeddings

Karaktergebaseerde chunking is prima voor gesprekken en onvoldoende voor
spreadsheets en pagina's; sequentiële embeddings zijn traag bij grote imports.
Allebei waar, allebei pas relevant zodra F-01 er is. Nu bouwen zou betekenen
dat je format-bewuste chunkers maakt voor formaten die nog niet gelezen worden.

### F-19 — Ingestion job / state machine

Terecht dat er geen centrale plek is waar staat hoe ver een document is en wat
veilig opnieuw kan. Maar de voorgestelde elf toestanden (RECEIVED, STORED,
HASHED, PARSING, PARSED, CHUNKED, EXTRACTING, DEDUPING, EMBEDDING,
REVIEW_READY, INDEXED, FAILED) zijn een pipeline die nog niet bestaat. Bouw de
pipeline eerst; de toestanden volgen uit wat er werkelijk misgaat, niet
andersom.

---

## 4. Waar ik het niet mee eens ben

### 4.1 F-13, F-22, F-23 — "Migreer naar de reeds ontworpen V2-architectuur"

Dit is het grootste meningsverschil, en het raakt drie bevindingen tegelijk:
knowledge lifecycle uitbreiden naar CANDIDATE/VALIDATED/ACTIVE/SUPERSEDED,
Claims scheiden van Evidence met een uniforme Source→Chunk→Claim-lineage, en
Entity linking, relationships en contradiction management toevoegen.

**Waarom ik het er niet mee eens ben:**

*Ten eerste: de "reeds ontworpen V2-architectuur" is geen ontwerp maar een
schets.* `docs/architecture-v2/SECOND_BRAIN_ARCHITECTURE.md` is 2,2 kilobyte —
ruim één pagina — en begint met de regel `**Status:** Review required`. Het is
nooit vastgesteld. De audit behandelt dat document als de norm en noemt de
werkende implementatie "te eenvoudig ten opzichte van V2". Dat draait de
verhouding om: de code is het ding dat werkt, de schets is een idee dat nog
beoordeeld moet worden. Een ontwerpdocument dat rijker is dan de implementatie
is de normale toestand van elke roadmap, geen bevinding.

*Ten tweede: dit is complexiteit voor een probleem dat zich nog niet heeft
voorgedaan.* Entity linking, een relatiegraaf en contradiction management zijn
zware machinerie. Ze voegen review-last, foutmodi en onderhoud toe. De vraag
die eerst beantwoord moet worden is niet "beschrijft V2 dit?" maar "heeft een
tegenstrijdigheid in de Second Brain jou ooit een verkeerd antwoord
opgeleverd?". Zolang dat niet is gebeurd, bouw je een oplossing waarvan je de
vorm van het probleem nog niet kent — en dat wordt bijna altijd de verkeerde
vorm.

*Ten derde: de goedkope helft zit er nu al in.* Het concrete verlies dat F-06
beschreef — een tweede bron die verdween — is gerepareerd zonder
re-architectuur. Dat is het patroon dat ik hier zou aanhouden: neem per keer
het stuk dat een aanwijsbaar probleem oplost.

**Wat ik in plaats daarvan voorstel:** wacht op een concreet geval. Kom je een
kennisitem tegen dat aantoonbaar achterhaald is en dat een nieuw item zou
moeten vervangen, dan is `supersedes` opeens een concrete behoefte met een
bekende vorm, en bouwen we precies dat. Stap 16 op de roadmap (Council V1.5,
Claim Ledger) raakt hier trouwens al aan — dat is de natuurlijke plek, niet een
aparte migratie van het hele kennismodel.

### 4.2 F-20 — "Model Router is nog geen capability router"

Hier ben ik het om twee redenen niet mee eens, en de eerste staat in de
bevinding zelf.

Het reviewdocument schrijft bij het bewijs: *"De codecomment noemt rijkere
routing expliciet v1+ scope"* — en registreert het vervolgens alsnog als
bevinding. Een bewust uitgestelde keuze, die op de plek zelf is opgeschreven
mét reden, is geen tekortkoming. Zo wordt elk niet-gebouwd deel van een roadmap
een auditpunt, en dat maakt het aantal bevindingen groter zonder dat het iets
zegt.

Daarbij staat het al op de roadmap, concreter dan de audit voorstelt: **Stap 24
— LLM-provider request-scoped maken, écht in-app wisselbaar.** Dat is bovendien
de stap die vandaag pijn deed: toen de Anthropic-credits op waren, kostte het
omschakelen naar OpenAI een handmatige ingreep in de Vercel-omgevingsvariabelen
plus een redeploy, en de Council werkt pas weer zodra beide sleutels er staan.
Dát is het echte, gevoelde probleem — niet dat extraction en review niet per
capability gerouteerd worden.

### 4.3 F-24 — Parser- en extractieversies in provenance

Als los punt: oneens, maar alleen qua timing. Versienummers vastleggen voor een
parser die nog niet bestaat en een chunker die nog niet bestaat, levert velden
op die `"v1"` bevatten omdat er nooit een v2 is geweest. Dit hoort bij F-01/F-12
en heeft daarbuiten geen betekenis. Als apart auditpunt met eigen prioriteit
suggereert het werk dat losstaand gedaan kan worden, en dat kan het niet.

### 4.4 F-14, F-15, F-25, F-11 — Eens met de waarneming, oneens met de urgentie

**F-14 (retrieval haalt maximaal 500 items op):** de beschrijving klopt precies.
Maar of het een probleem is, hangt volledig af van één getal dat de audit niet
noemt: hoeveel goedgekeurde kennisitems er zijn. Onder de 500 heeft deze
bevinding letterlijk nul effect — dan wordt alles opgehaald en alles
gerangschikt. De juiste reactie is dus niet nu een index bouwen, maar dat getal
weten en er een grens aan hangen. Een geïndexeerde retrievallaag bouwen voor
een dataset die in zijn geheel in één query past, is werk zonder waarneembaar
resultaat.

**F-15 (geen freshness/version-filters):** de bevinding zegt zelf dat dit pas
speelt *"zodra lifecycle wordt uitgebreid"*. Dat is dus geen huidige
tekortkoming maar een vervolg op 4.1, waar ik het niet mee eens ben.

**F-25 (file size/type-controle is metadata-gebaseerd):** waar, maar de
onderbouwing klopt niet voor dit systeem. Het scenario is "een gemanipuleerde
client omzeilt de limieten" — terwijl de enige geauthenticeerde client jij bent,
en de server op dit moment überhaupt geen bytes ontvangt om te valideren. De
echte reden om dit te doen is robuustheid zodra binaire upload bestaat, niet
beveiliging. Dus: meebouwen met F-02, niet als eigen beveiligingspunt.

**F-11 (JSON-parsing is fragiel):** waar, en de ernst "MIDDEL" is goed gekozen.
De voorgestelde oplossing (provider structured output) is alleen niet
providerneutraal, en dit project draait bewust op twee providers die daar
verschillend mee omgaan. Een gedeelde validator met één gecontroleerde
reparatiepoging is hier het betere antwoord — dezelfde discipline als
`parseCouncilVerdict` en de automated-signoff-parser al hanteren: bij
onduidelijkheid gecontroleerd falen, nooit half opslaan.

### 4.5 F-08 — Deels

"Niet atomair of idempotent" is waar en de gevolgen zijn reëel. Maar de
voorgestelde oplossing (IngestionJob met deterministische job key) is dezelfde
zware machinerie als F-19, terwijl het grootste deel van de pijn met veel
minder verdwijnt: de reparaties van F-06 en F-09 maken herhaald importeren
hierboven al grotendeels idempotent, want een tweede import maakt geen tweede
kennisitem meer aan. Wat overblijft is de documentstatus die bij een fout
halverwege niet klopt. Dat is één veld, geen state machine.

### 4.6 Over het document als geheel

Twee dingen die geen bevinding zijn maar wel bepalen hoe je dit document moet
lezen.

**Het "implementatieplan voor Claude Code" (hoofdstuk 7) en de "Definition of
Done" (hoofdstuk 8) gaan langs de manier heen waarop dit project werkt.** Zeven
fasen, veertig stappen, met als eerste opdrachttekst "voer een gecontroleerde
refactor uit". In The Dost Matrix worden wijzigingen als missie gebouwd, via een
branch en een pull request, met jouw goedkeuring of een geautomatiseerde
beoordeling ervoor. Een refactor van deze omvang als één opdracht uitvoeren zou
precies dat omzeilen. De inhoud van het plan is grotendeels goed; de vorm is
die van een extern team dat de repo overneemt.

**De "Definition of Done" verklaart de Knowledge Foundation niet
productiegeschikt op criteria die jij nooit gesteld hebt.** Elf eisen, waaronder
volledige claim/evidence-scheiding en lifecycle-modellering. Dat is de norm van
het document, niet die van dit project. Jouw norm staat in `docs/roadmap.md` en
in de architectuurprincipes, en die zeggen iets anders: één eigenaar, menselijke
goedkeuring, en geen scherm dat iets claimt wat niet is gebeurd. Aan dat laatste
voldeed de Knowledge Foundation niet — daarom is F-03 gerepareerd.

---

## 5. Wat de audit opleverde, samengevat

De feitelijke nauwkeurigheid was hoog: alles wat ik natrok, klopte. De zes
reparaties in hoofdstuk 2 zijn allemaal echte fouten die niemand had gemeld,
omdat ze geen van alle een foutmelding gaven — een leeg `if`-blok, een
fingerprint die niet meeliep, een teller die duplicaten meetelde, een scherm dat
"verwerkt" zei. Dat is precies waar een blik van buiten voor dient.

Waar de audit overschiet, is bij het gelijkstellen van "de schets beschrijft
meer" aan "de implementatie schiet tekort", en bij het inschalen van
ontbrekende capaciteit als kritiek defect. Van de negen bevindingen die als
KRITIEK of met prioriteit P0 zijn aangemerkt, waren er vier werkelijke fouten
(nu gerepareerd) en vier ontbrekende functionaliteit — reëel, maar iets anders
dan kapot.
