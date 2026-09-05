# The Dost Matrix — Roadmap

Dit bestand is de enige plek waar de volledige, woordelijke inhoud van de
lopende roadmap staat. Reden: eerdere versies van deze roadmap zijn alleen
mondeling/in gesprek vastgesteld en zijn bij een gesprekscompressie
onherstelbaar verloren gegaan (stap 5 t/m 10 van de oorspronkelijke
roadmap). Zie de skill `dost-matrix-collaboration` voor de afspraak die dit
voorkomt: elke roadmap-wijziging wordt hier bijgewerkt en gecommit, niet
alleen samengevat in geheugen.

Werk dit bestand bij (niet vervangen door een nieuwe versie) zodra een stap
wordt afgerond of de roadmap verandert.

## Voltooid

### Stap 1 — Second Brain learning loop
Voltooide/geannuleerde missies stellen automatisch een kennisitem voor
("Mogelijk kennisitem"), zodat lessen uit een missie standaard bij Second
Brain terechtkomen voor Elroy's beoordeling, in plaats van alleen bij
handmatig chat-gebruik. Dit geldt voor de Director/Builder/QA-loop van
Mission Engine V2 zelf, niet alleen voor chat: `proposeMissionKnowledge`
(mission-knowledge.ts) wordt aangeroepen zodra een missie COMPLETED wordt
(director-runtime.ts) én vanuit de "cancel"-actie voor CANCELLED missies
(route.ts), en legt de gedestilleerde kennis als "pending" voor — net als
de chat- en document-import-bronnen. (Dit werd later, vóórdat het werd
opgemerkt, nogmaals als "Stap 8" voorgesteld — bij verificatie bleek dat
al onder deze stap te vallen; zie "Voorgestelde volgende stappen".)

Testdekking was hier aanvankelijk volledig afwezig; toegevoegd via PR #30
(`director/mission-810c4e48-1788542274372`) als `mission-knowledge.test.ts`,
met zes tests die o.a. de bewuste "fail-open"-garantie vastleggen: een
falende LLM-aanroep, ongeldige JSON of een mislukte Firestore-write mogen
nooit een fout naar boven gooien en dus nooit de afronding of annulering
van de missie zelf laten mislukken.

### Stap 2 — Echte, nooit-blokkerende kostentracking
Werkelijk tokengebruik en USD-kostenschatting per LLM-aanroep, zichtbaar per
missie in de UI. Expliciete keuze: budget/kosten mogen een missie nooit
stoppen, pauzeren of laten falen — puur informatief.

### Stap 3 — Missie-risiconiveau-handhaving
`mission.riskLevel` (LOW/MEDIUM/HIGH/CRITICAL, instelbaar bij aanmaken) wordt
nu daadwerkelijk gebruikt: bij LOW blijft de bestaande bestandsgebaseerde
auto-approve/needs-signoff-classificatie leidend; bij MEDIUM/HIGH/CRITICAL
is het altijd needs-signoff, ongeacht hoe klein/geïsoleerd de wijziging is.

### Stap 4 — In-app "Goedkeuring & Mergen"
Een needs-signoff pull request kan direct vanuit The Dost Matrix zelf worden
gemerged (via de GitHub API), zonder dat Elroy naar GitHub.com hoeft. Beide
bestaande veiligheidsnetten (alle succescriteria PASSED, CI groen) blijven
gelden; het klikken op de knop telt zelf als de vereiste goedkeuring.

### Stap 5 — Gestructureerde foutcodes i.p.v. string-matching
De "Goedkeuring & Mergen"-knop verscheen voorheen doordat de UI zocht naar de
tekst "risicoclassificatie: needs-signoff" in een foutmelding. Dat is nu
vervangen door een echt, machineleesbaar foutcode-veld dat van begin tot
eind meeloopt: `DirectorRuntimeError` (director-runtime.ts) geeft een code
als `NEEDS_SIGNOFF` mee, de API-route (route.ts) zet die door in de JSON-
foutrespons, de client (mission-engine-v2-service.ts) geeft hem door aan de
UI, en het dashboardpaneel (mission-engine-v2-panel.tsx) controleert nu op
die code in plaats van op de bewoording van de foutmelding. Afgerond en
gemerged via PR #25 (`director/mission-3bff728b-1788507406678`); PR #24 en
#26 waren eerdere, onvolledige pogingen en zijn als duplicate/superseded
gesloten.

### Stap 6 — GitHub App i.p.v. fine-grained token
`GITHUB_BUILDER_TOKEN` (een fine-grained personal access token) miste
toegang tot de Checks-API — een bevestigde GitHub-limitatie voor dit
tokentype. De builder-, qa- en Director-rollen authenticeren nu in plaats
daarvan als GitHub App-installatie: `github-client.ts` ondertekent zelf een
kortlevende App-JWT (RS256, via Node's ingebouwde `crypto`-module, dus geen
nieuwe dependency) en wisselt die in voor een installation access token
(gecachet, automatisch ververst vóór het verloopt). Drie nieuwe
omgevingsvariabelen: `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`,
`GITHUB_APP_PRIVATE_KEY`. Afgerond en gemerged via PR #27
(`director/mission-290afd58-1788529670596`).

### Tussentijdse fix — Builder testte code die hij nooit had gezien
Geen genummerde roadmapstap, maar wel een structurele betrouwbaarheids-fix
aan de Builder-rol zelf, vóór stap 7 uitgevoerd omdat vier opeenvolgende
missies (PR #24, #25, #26, #27) hierdoor kapotte testbestanden opleverden.
Root cause: `writeSingleFile()` in `builder-runtime.ts` schreef elk bestand
via een volledig geïsoleerde LLM-aanroep, waardoor de Builder bij een nieuw
(test)bestand geen zicht had op de daadwerkelijke inhoud van de bestanden
die hij moest testen — met verzonnen functienamen en Jest-syntax in een
vitest-project tot gevolg. Fix: de Builder krijgt nu bij het schrijven van
een testbestand automatisch de volledige inhoud van de bijbehorende
bronbestanden uit dezelfde toewijzing mee, plus één bestaand testbestand
als stijl-/frameworkvoorbeeld, plus een expliciete vitest-instructie;
niet-testbestanden worden bovendien altijd vóór testbestanden geschreven.
Afgerond en gemerged via PR #28 (`builder-runtime-context-fix`).

### Stap 7 — Echte CI-statuscontrole vóór automerge
Bij verificatie bleek deze stap al functioneel gebouwd te zijn, niet als
aparte missie maar eerder als reactieve fix op een live incident (QA keurde
ooit een pull request met drie verzonnen imports goed ondanks falende CI).
`ensureMissionPullRequestMerged` (director-runtime.ts) controleert vóór
zowel de automatische merge als de "Goedkeuring & Mergen"-knop al de
daadwerkelijke CI-status via `getCombinedCheckStatus` (github-client.ts) en
weigert te mergen met een structurele `CI_CHECKS_FAILED`/`CI_CHECKS_PENDING`-
foutcode zolang die niet geslaagd is — ongeacht risicoclassificatie. De
roadmap was hier simpelweg niet op bijgewerkt.

Bij dezelfde verificatie kwam wel een echt gat naar boven: geen enkele
automatische test oefende deze CI-statuscontrole daadwerkelijk uit.
`director-runtime.test.ts` bevatte een commentaar dat beweerde dat
`route.test.ts` dit al dekte, maar dat bestand test alleen de
`NEEDS_SIGNOFF`-code, niet `CI_CHECKS_FAILED`/`CI_CHECKS_PENDING`. Opgelost
via een losse, laag-risico missie: `director-runtime.ensureMissionPullRequestMerged.test.ts`
(zes tests: geen PR gevonden, PR al gemerged, CI mislukt, CI nog bezig, CI
geslaagd + auto-approve → mergt, CI geslaagd + needs-signoff → mergt niet).
De Builder verzon bij de eerste poging opnieuw een niet-bestaand
invoerformaat voor `ensureMissionPullRequestMerged` — exact dezelfde fout
als bij PR #24/#26/#27, ook al staat er letterlijk een JSDoc-commentaar bij
de functie die deze specifieke valkuil beschrijft. Dit bevestigt dat de
context-fix uit builder-runtime.ts (hierboven) de isolatie bij NIEUWE
bestanden oplost, maar niet garandeert dat de Builder een bestaande,
zichtbare functiesignatuur ook daadwerkelijk leest in plaats van aanneemt.
Het testbestand is daarom rechtstreeks herschreven i.p.v. teruggestuurd
naar een nieuwe Builder-toewijzing. Afgerond en gemerged via PR #29
(`director/mission-f6b76b2f-1788539538423`).

## Voorgestelde volgende stappen

Stap 9 t/m 14 zijn door Claude bedacht als logisch vervolg op de voltooide
stappen, gebaseerd op wat Elroy al eerder heeft aangegeven te willen
(multi-LLM, Claude ingebed in de app zelf, een écht autonome Director) en op
concrete technische kanttekeningen die tijdens het bouwen van stap 1 t/m 6
al zijn gesignaleerd maar nog niet zijn opgelost. Dit is een voorstel, geen
vaststaand plan — pas aan, herschik of schrap wat niet (meer) relevant is.
Stap 15 is door Elroy zelf toegevoegd; de invulling ervan volgt later.
(Stap 7 stond hier oorspronkelijk ook bij, maar bleek bij verificatie al
gebouwd te zijn — zie "Voltooid" hierboven. Stap 8 — een schrijfhaak vanuit
de missie-loop naar Second Brain — bleek om dezelfde reden een letterlijke
duplicaat van Stap 1 en is geschrapt in plaats van verplaatst; de wél
gevonden ontbrekende testdekking voor `mission-knowledge.ts` is afgehandeld
als losse missie — zie Stap 1 hierboven.)

Werkafspraak sinds deze reeks: testbestanden worden niet meer door de
Builder-rol geschreven maar rechtstreeks aangeleverd. Aanleiding is een
harde score over deze hele reeks — de Builder kreeg geen enkele van de vijf
testopdrachten (PR #24/#26, twee bestanden in #27, #29, #30) in één keer
goed, terwijl elke rechtstreeks geschreven versie de CI wél meteen haalde.
De fouten werden onderweg wel steeds kleiner (van volledig verzonnen
functies, via een verzonnen invoerobject, naar uiteindelijk alleen nog een
ontbrekend argument en een verkeerde aanname over sync/async), en de
vangnetten (CI + verificatie vóór merge) hebben elke keer gewerkt: er is
nooit iets kapots op `main` beland. Dit is een pragmatische keuze specifiek
voor testbestanden, geen permanente wijziging aan de Mission Engine.

### Herziening van de volgende stappen (4 september 2026)
De oorspronkelijke stap 9 (een multi-LLM-selector die per taak het beste
model kiest) is vervallen. Aanleiding: een experiment met `claude-opus-5`
in plaats van `claude-sonnet-5` op exact dezelfde testopdracht faalde op
dezelfde manier (PR #31). Modelkeuze is dus niet de beperkende factor, en
een selector zou het bewezen probleem niet hebben opgelost. Wat er wél voor
in de plaats komt, staat hieronder.

De onderstaande volgorde is vastgesteld na een volledige architectuurreview
van de Builder-keten (`docs/mission-engine-v2-review.docx`), een
onafhankelijke tweede beoordeling door ChatGPT
(`ChatsAnswerToClaude_V1.docx`), een broncodeverificatie daarvan
(`ClaudesAnswerToChat_V1.docx`) en een gezamenlijke ontwerpspecificatie voor
de raadslaag (`TheDostCouncil_V2.docx`). Alle vier staan in `docs/`.

De bewezen oorzaak achter vijf mislukte testopdrachten: de Builder krijgt de
broncode die hij moet gebruiken structureel niet te zien. `writeSingleFile()`
stelt de context statisch samen vóórdat er iets geschreven is, en bij een
opdracht "schrijf tests voor bestaand bestand X" valt X buiten de toewijzing
— precies omdat de opdracht verbiedt X te wijzigen. Het onderscheid dat
ontbreekt is dat tussen *schrijfbare* bestanden en *leesbaar bewijs*.

Leidend principe voor de volgorde hieronder: de kleinste stap die Elroy het
snelst uit de handmatige correctielus haalt, gaat vóór architectonische
volledigheid. Reden: er is geen team dat dit bouwt, en de rol die het zou
moeten bouwen (de Builder) is precies de kapotte rol — elke stap wordt met
de hand geschreven en door Elroy gecommit.

### Stap 9 — Eén stabiele missiebranch
Bevestigde bug: `executeBuilderAssignment()` vertrekt bij ELKE toewijzing
opnieuw vanaf de standaardbranch, maakt een nieuwe branch met tijdstempel,
en leest ook de "huidige inhoud" van bestanden van de standaardbranch. Werk
van een eerdere toewijzing binnen dezelfde missie is daardoor onzichtbaar,
en kan bij het mergen van een latere pull request stilzwijgend worden
overschreven. Ook QA raakt dit: `findMissionPullRequest` pakt altijd alleen
de nieuwste pull request van een missie.

Wat er komt: één stabiele missiebranch per missie, alle lees- en
schrijfacties vanaf die branch, en `currentCommitSha` in de missiestatus.
Dit is bovendien een harde voorwaarde voor stap 11.

### Stap 10 — Bewijslaag voor de Builder (Context Resolver V1)
Splits binnen een toewijzing expliciet twee soorten bestanden: schrijfbare
bestanden (mag gewijzigd worden) en leesbaar bewijs (moet zichtbaar zijn,
mag niet gewijzigd worden). Voor een testbestand wordt automatisch de module
onder test plus zijn directe relatieve imports als bewijs meegestuurd, plus
een relevant bestaand testbestand uit dezelfde map (nu is dat de alfabetisch
eerste uit de hele repo — willekeurig). In de prompt komt een expliciet
contextmanifest: dit is wat je daadwerkelijk hebt gezien.

Bewust dom en deterministisch in V1: geen AST-analyse, geen path-aliassen,
geen barrel-exports. Kan het benodigde bewijs niet betrouwbaar worden
gevonden, dan faalt de toewijzing expliciet met een gestructureerde fout
`INSUFFICIENT_CONTEXT` — in dezelfde stijl als de bestaande foutcodes uit
stap 5, en in dezelfde geest als het bestaande harde falen bij te grote
bestanden. Liever expliciet stoppen dan stilzwijgend gokken.

### Stap 11 — Verificatie als missiestatus, met technische herstellus
GitHub Actions is de uitvoeromgeving die we al hebben; we gebruiken hem
alleen te laat. Nieuwe volgorde: de Builder commit naar de missiebranch, de
missie krijgt status `AWAITING_VERIFICATION`, en het HTTP-request eindigt
daar (geen minutenlange wachtlus in een Next.js API-route). Een volgende
Director-stap leest de CI-status op exact die commit-SHA: groen → pull
request openen; rood → `TECHNICAL_REPAIR` met de echte foutuitvoer erbij,
met een hard plafond van drie pogingen; plafond bereikt → gestructureerd
falen in plaats van een slechte pull request.

Herstelpogingen zijn nieuwe commits op dezelfde missiebranch, en `upsertFile`
moet daarbij de bestands-SHA van de missiebranch gebruiken — niet die van
`main`, want dan draait een herstelpoging zijn eigen vorige poging terug.
Vereist eenmalig een handmatige wijziging in `.github/workflows/ci.yml` (een
push-trigger op de missiebranch-prefix), door Elroy zelf geplakt: de
remote-tool blokkeert bewust schrijven onder `.github/workflows/`, en die
grens blijft.

Dit is de stap die Elroy uit de correctielus haalt.

### Stap 12 — QA-bewijsbundel en semantische herstellus
QA heeft dezelfde blinde vlek als de Builder: hij haalt alleen de gewijzigde
bestanden van een pull request op, dus bij een testbestand ziet hij de module
niet waar die tests tegenaan praten. QA krijgt daarom een bewijsbundel:
gewijzigde bestanden plus diff, de opgeloste afhankelijkheden daarvan, de
verificatieresultaten, en de succescriteria.

Daarnaast een tweede, aparte herstelroute: `SEMANTIC_REPAIR` voor het geval
de CI groen is maar QA een criterium afkeurt. Dat is een andere soort fout
dan een compileerfout en vraagt een andere reparatie, met een eigen
pogingteller. Uitgeput → `MISSION_NEEDS_REVIEW`.

### Stap 13 — The Dost Council V1 (dun)
Een raadslaag naast de Mission Engine: meerdere modellen die onafhankelijk
analyseren, elkaars voorstel bekritiseren, en expliciet oneens mogen zijn.
Het waardevolste product is niet de consensus maar de bewijsgebonden
onenigheid.

V1 draait op de twee API-sleutels die al werken (Anthropic en OpenAI) en op
de bestaande `chatCompletion`-interface — function calling is hiervoor niet
nodig. Protocol: ronde 1 blind en parallel (voorkomt anchoring), ronde 2
geanonimiseerde wederzijdse kritiek, ronde 3 synthese die waar mogelijk
deterministisch door code gebeurt. Geen meerderheidsstem als waarheid; bij
QA-inzet geldt alleen unanimiteit als goedkeuring en gaat elke onenigheid
met beide argumenten naar Elroy.

Eerste plek: een expliciete raadsmodus in de Director-chat ("Ask the
Council"), omdat een fout besluit daar de merge-route niet raakt. De Builder
blijft één model — daar is het probleem context, niet gebrek aan meningen.

Bewust NIET in V1, om te voorkomen dat we opnieuw een groot bouwwerk
neerzetten voordat het idee zich bewezen heeft: het volledige Claim Ledger
met gevalideerde bewijsverwijzingen, persistente datamodellen, automatische
triggers en extra providers.

Stopcriterium, vooraf vastgelegd: als de raad na tien sessies geen enkele
keer een besluit heeft veranderd of een fout heeft gevangen die één model
miste, gaat de raad er weer uit. Verwachte kosten: grofweg een halve dollar
per sessie bij een bewijspakket van zo'n 10.000 tokens, meer zodra er
volledige bronbestanden in zitten. Kosten blokkeren nooit — maar ze worden
wel gemeten.

### Stap 14 — Council V1.5: Claim Ledger, validatie en uitbreiding
Pas nadat stap 13 zich bewezen heeft: het Claim Ledger waarin elke
technische claim bewijsverwijzingen, steun/tegenspraak en een status
(SUPPORTED / DISPUTED / UNKNOWN / REFUTED) krijgt, met runtime-validatie dat
een bewijsverwijzing daadwerkelijk bestaat — een verzonnen verwijzing wordt
geweigerd in plaats van geloofd. Bewijsverwijzingen zijn gepind aan de
commit-SHA van het bewijspakket; na een herstelpoging vervalt eerder bewijs.

Daarna pas: extra providers via een Model Registry (de OpenAI-compatibele
aanbieders vragen alleen configuratie, Google vraagt een eigen adapter),
en automatische triggers bij herhaald falen, hoog risico of tegenstrijdige
QA.

### Stap 15 — Director Evidence Upgrade
De Director ziet nu alleen rol, status en opdrachttekst van eerdere
toewijzingen — niet de roleOutput, niet de inhoud van de pull request, niet
de CI-uitkomst. Zolang de Builder faalde was dat niet de knellendste
beperking; zodra stap 9 t/m 12 staan, wordt dit de volgende bovengrens aan
wat de missielus zelfstandig kan. Compacte, gepinde resultaten van vorige
stappen beschikbaar maken voor de volgende beslissing.

### Stap 16 — Geavanceerde context en tools voor de Builder
Pas na bewezen behoefte: alias-, barrel- en typeresolutie in de Context
Resolver, begrensde lees-/zoektools voor de Builder (vereist uitbreiding van
de `LlmProvider`-interface met function calling, per aanbieder verschillend),
patch-gebaseerd schrijven in plaats van hele bestanden herschrijven, en een
deterministische signatuurcontrole als extra verdediging.

### Stap 17 — In-app CI/PR-zichtbaarheid
(voorheen stap 10) Toon PR-status (open/gemerged, CI groen/rood, welke
checks) direct in de missie-kaart, zodat Elroy nooit naar GitHub.com hoeft om
te zien waar een missie op vastloopt. Sluit aan op de verificatiestatus uit
stap 11.

### Stap 18 — Doorzoekbare Second Brain-UI
(voorheen stap 11) Een eenvoudig zoek-/filterscherm (op onderwerp, missie,
datum) binnen Command Center, zodat kennis terugvindbaar is zonder dat Elroy
weet welke missie 'm oorspronkelijk voorstelde.

### Stap 19 — Missie-sjablonen
(voorheen stap 12) Voor terugkerende soorten missies een herbruikbaar
sjabloon met vooraf ingevulde objective/succescriteria.

### Stap 20 — Claude zichtbaar ingebed in de app
(voorheen stap 13) Een paneel in Command Center dat live meekijkt met een
externe Claude Code/Cowork-sessie (logs/activiteit). Nog geen
twee-richtingen besturing — puur zichtbaarheid als eerste stap.

### Stap 21 — Autonome missie-triggers
(voorheen stap 14) De Director mag zelf, op basis van een vooraf goedgekeurde
regel, een missie voorstellen of starten — met dezelfde risicoclassificatie
en approve-and-merge-veiligheidsnetten als elke andere missie. Eerste
concrete stap richting het Jarvis-achtige eindbeeld.

### Stap 22 — Visualisatie van wat er achter de schermen gebeurt
(voorheen stap 15, door Elroy zelf toegevoegd) Een visuele weergave van de
live activiteit binnen The Dost Matrix (missies, rollen, Second
Brain-updates, verificatiestatus, raadssessies) zodat Elroy in één oogopslag
ziet wat het systeem doet. De precieze vorm wordt later samen ontworpen —
dit is bewust nog niet ingevuld.

## Acceptatiecriteria voor stap 9 t/m 12

Overgenomen uit de tweede beoordeling: het probleem geldt pas als opgelost
wanneer deze regressiemissies slagen, niet wanneer één missie toevallig goed
gaat.

- **A** — Tests toevoegen aan een bestaande functie met twee argumenten,
  terwijl wijzigen van productiecode verboden is. De Builder moet de echte
  signatuur lezen en groene tests opleveren zonder tussenkomst. (stap 10)
- **B** — Een functie testen waarvan het gedrag afhangt van geïmporteerde
  helpers met gemockte returnvormen. Geen verzonnen vormen. (stap 10)
- **C** — Een module die via een barrel-export of path-alias wordt
  geïmporteerd. (pas verwacht bij stap 16)
- **D** — Opzettelijk een compileerfout in poging 1. De CI-fout moet
  automatisch worden hersteld binnen het pogingplafond. (stap 11)
- **E** — Een missie met twee opeenvolgende Builder-toewijzingen. De tweede
  moet het werk van de eerste zien. (stap 9)
- **F** — QA een test-only diff voorleggen met een bewust verkeerde
  mock-signatuur. QA moet die afkeuren op inhoud, niet pas via de CI.
  (stap 12)
