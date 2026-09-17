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

### Stap 9 — Eén stabiele missiebranch
Bevestigde bug: `executeBuilderAssignment()` vertrok bij ELKE toewijzing
opnieuw vanaf de standaardbranch, maakte een nieuwe branch met tijdstempel,
en las ook de "huidige inhoud" van bestanden van de standaardbranch. Werk van
een eerdere toewijzing binnen dezelfde missie was daardoor onzichtbaar, en kon
bij het mergen van een latere pull request stilzwijgend worden overschreven.

Opgelost: elke missie heeft nu één vaste werkbranch, `director/mission-<id>-work`
(zonder tijdstempel). Bestaat die al, dan wordt hij hergebruikt; bestaat hij
niet, dan wordt hij aangemaakt vanaf de kop van de standaardbranch. Alle
leesacties — bestandsboom, huidige bestandsinhoud, het voorbeeldtestbestand —
komen van die branch, waardoor ook de bestands-sha's die `upsertFile` gebruikt
van de missiebranch komen in plaats van van `main`. Staat er al een open pull
request voor die branch, dan komen nieuwe commits daar automatisch bij en wordt
er geen tweede geopend.

De naamgeving staat nu in een eigen, dependency-vrije module
(`mission-branch.ts`), zodat de Builder en de QA-rol dezelfde afspraak
gebruiken. De naam begint bewust nog steeds met `QA_BRANCH_PREFIX`, zodat
`findMissionPullRequest` ongewijzigd blijft werken — ook voor de oudere
tijdstempel-branches van missies die vóór deze wijziging zijn gestart. Die
oude branches worden bewust niet geadopteerd.

Scope-keuze: `currentCommitSha` in de missiestatus stond hier oorspronkelijk
ook bij, maar vraagt wijzigingen in het missiemodel, de Firestore-opslag en de
engine, terwijl niets het nu leest. Dat is verplaatst naar stap 11, waar de
verificatie-state-machine het daadwerkelijk nodig heeft.

Afgerond via branch `stap-9-stabiele-missiebranch`, met tien nieuwe tests in
`builder-runtime.mission-branch.test.ts` (branch hergebruiken, aanmaken bij een
404, doorgooien bij elke andere fout, en het herkennen van de open pull request
inclusief het negeren van oude tijdstempel-branches).

Regressie E is daarna live gedraaid als echte missie ("Regressietest E — twee
toewijzingen op één missiebranch"): twee opeenvolgende builder-toewijzingen,
één branch (`director/mission-11f7af06-work`), één pull request (#33) met twee
commits, en een bestand waarin het werk van de eerste toewijzing ongewijzigd
bleef staan toen de tweede eraan toevoegde. Vóór deze fix was dat onmogelijk
geweest.

Bijvangst voor stap 12: QA merkte in zijn beoordeling op dat "beide delen in
één keer zijn toegevoegd" en dat het tweestaps-scenario dus niet zuiver getest
zou zijn. Dat is feitelijk onjuist en illustreert precies de blinde vlek die
stap 12 aanpakt — QA ziet alleen de cumulatieve diff tegenover `main`, niet de
commitgeschiedenis, en kan het verschil tussen één en twee toewijzingen dus
niet zien.

### Tussentijds — Eerlijke UI-basis en modulair Command Center
Niet als roadmapstap gepland, maar tussen stap 9 en stap 10 uitgevoerd op
verzoek van de eigenaar, op basis van zijn eigen UI-ontwerp en het
functioneel ontwerp van ChatGPT.

**Deel 1 — geen verzonnen status meer.** De topbar toonde "SYSTEM STATUS /
OPERATIONAL" en vaste tellers voor agents en approvals die nergens vandaan
kwamen. Vervangen door `system-status.ts` met per component een expliciet
`checkedVia`-veld: alleen de GitHub-verbinding wordt daadwerkelijk live
gecontroleerd, LLM en Firestore worden afgeleid uit configuratie. Dat
onderscheid staat nu in de UI zelf, zodat een groen bolletje nooit meer
belooft dan er gecontroleerd is. De statusroute (`/api/system/status`) is
auth-gated en geeft geen sleutels of secrets terug.

**Deel 2 — missievoortgang.** `mission-progress.ts` leidt uit een missie
precies vijf fases af (planning, builder, qa, criteria, merge), elk met een
feitelijke toelichting uit de missiedata zelf. De fases "Verificatie" en
"Review" uit het functioneel ontwerp ontbreken hier bewust: die bestaan pas
na stap 11 en stap 12, en een lege fase tonen zou dezelfde soort belofte
zijn als de verzonnen status hierboven. Onder de fases staan de
succescriteria mét `lastEvaluationNote` — de QA-toelichting die tot dan toe
alleen de Director zag, terwijl daar staat waaróm iets is afgekeurd.

**Deel 3 — modulaire indeling op één scherm.** Het Command Center bestond
uit één component van bijna 30 KB (`mission-engine-v2-panel.tsx`) waarin het
aanmaakformulier, de uitvoering, de voortgang en de missielijst samen zaten,
met de indeling erin verweven. Een paneel verplaatsen was daardoor niet
mogelijk zonder de component te herschrijven, en de pagina had twee varianten
(`compact`/`full`) die uit elkaar konden lopen — dat gebeurde ook: het
voortgangspaneel stond een tijd lang alleen in de ene variant.

Nu houdt `MissionEngineProvider` (`mission-engine-store.tsx`) alle
missietoestand vast en zijn de panelen weergaven **zonder props**:
`MissionCreatePanel`, `MissionExecutionPanel`, `MissionProgressPanel`,
`RecentMissionsPanel`. Een pagina is niet meer dan een indeling, en een
paneel naar een andere kolom of een andere pagina verplaatsen kost één regel
JSX. De detailpagina `/dashboard/missions-v2` gebruikt exact dezelfde
componenten in een bredere indeling — er is geen tweede versie van het
formulier of de uitvoeringslogica meer die kan afwijken.

Het Command Center toont drie kolommen met een vaste breedte, van links naar
rechts: chat met de Director, de Mission Engine, en de statuskolom met
"Director & uitvoering" boven en "Missievoortgang" eronder. Die vaste
breedtes staan als CSS-variabelen op één plek (`mission-panels.css`);
tekstvelden schalen alleen naar beneden, nooit in de breedte. Elke kolom
scrollt van binnen, zodat de drie kolommen samen in beeld blijven.

Bewust weggelaten: het Second Brain-paneel met de 3D-illustratie (verwijderd
op verzoek; de component blijft ongebruikt bestaan tot stap 18) en het
Dost Council-paneel uit het functioneel ontwerp (de Council bestaat nog niet
— stap 13; zodra die er is wordt het ontwerp van deze pagina opnieuw
bekeken).

**Deel 4 — chatbediening en het einde van de dubbele chat.** De chat kreeg de
bediening van een gewone chat-app: een invoerveld dat als één regel begint en
meegroeit tot ongeveer zes regels, een ronde verstuurknop, drie bewegende
puntjes zolang de Director nadenkt, een avatar naast zijn antwoorden en vier
startsuggesties die alleen zichtbaar zijn zolang het gesprek leeg is (ze
vullen het invoerveld, ze versturen niets). Enter-om-te-versturen en het
direct verschijnen van het eigen bericht werkten al: chat-service.ts schrijft
het bericht van de eigenaar naar Firestore vóór de LLM-aanroep.

Bijlagen zijn bewust NIET gebouwd. `LlmProvider.chatCompletion` accepteert
`LlmMessage[]` met een `content` van het type string, en er is nergens opslag
voor bestanden ingericht — een paperclip zou dus een bestandsnaam tonen die
de Director nooit ziet. Dat komt terug wanneer de modelverbinding beeld
aankan; tot die tijd staat er niets.

Daarnaast is een bug opgelost die al bestond vóór deze UI-ronde: lange
berichten liepen buiten de kolom en dwongen een horizontale schuifbalk af.
Twee oorzaken. `.chat-log` is een grid zonder opgegeven kolom, en een
grid-kolom is standaard `auto` — dus minstens zo breed als de breedste
inhoud; nu `minmax(0, 1fr)`. En tekst breekt alleen op een spatie, waardoor
een Firestore-id of een pad als één onbreekbaar woord doorliep; nu
`overflow-wrap: anywhere` binnen de chatbubbels. Dezelfde valkuil als eerder
bij `.mev2-top-grid`.

Ten slotte is `/dashboard/chat` verwijderd. Dat was geen los chatpaneel maar
een complete oude kopie van het Command Center — eigen missielijst op het
inmiddels vervangen missiemodel, eigen Second Brain-paneel, eigen tellers en
een gekopieerde chat. De pagina stond niet in de navigatie en was alleen
bereikbaar via een knop "Chat" op de Knowledge-pagina; die knop is weg, want
"Dashboard" ernaast wijst nu naar dezelfde plek. Er is nog één chat in de
app.

Restpunt: in `globals.css` staan nu enkele stijlblokken die alleen die
verwijderde pagina gebruikte (`command-center-intro`, `-stats`, `-brain`,
`-dashboard`, `-mission-list`). Bewust niet in dezelfde commit opgeruimd,
zodat zichtbaar blijft wat wat is.

### Tussentijdse fix — Missielijst en een teller op een dode collectie
Twee gaten die pas zichtbaar werden toen de eigenaar alle actieve missies
wilde afsluiten.

De missielijst haalde er vijf op, gesorteerd op laatst bijgewerkt, en er is
geen knop om verder te bladeren. Een missie buiten die vijf was daardoor via
de UI onbereikbaar — ook als hij nog ACTIVE was en dus alleen dáár
geannuleerd kon worden. Nu twintig, het maximum dat de API-route accepteert.
Bewust geen echte paginering: dat is pas de moeite waard als twintig ook te
weinig blijkt. Met twintig in beeld bleken er zeven missies open te staan,
allemaal werk dat allang gemerged was maar met de hand was afgemaakt in
plaats van door de Director; die zijn geannuleerd.

De teller "MISSIES" in de topbar las de Firestore-collectie `missions` — het
missiemodel van vóór Mission Engine V2, dat naar `missionEngineV2Missions`
schrijft. Hij stond dus op echte data, maar op de verkeerde, en liep niet mee
met de missies in de Mission Engine. Sinds het oude paneel en de dubbele
chatpagina weg zijn, schrijft niets meer naar die collectie en stond het
getal permanent stil. Verwijderd, samen met de missieregels in "Recent
Activity" die uit diezelfde bron kwamen en met een vangnet op het Command
Center dat een ontbrekende index van die dode collectie zou melden.

Bewust NIET vervangen door een teller op Mission Engine V2: een juist totaal
vraagt een telquery aan de serverkant, want de lijst-route geeft hooguit
twintig missies terug en niet het totaal. Zolang die er niet is telt het
scherm liever niets dan het verkeerde — dezelfde regel als bij de eerder
verwijderde tellers "AGENTS" en "APPROVALS".

### Stap 10 — Bewijslaag voor de Builder (Context Resolver V1)
De Builder weet niets buiten zijn opdracht om, en vult alles wat daar niet in
staat aannemelijk in. De fix uit "Tussentijdse fix — Builder testte code die
hij nooit had gezien" stuurde bij een testbestand al de inhoud mee van de
ANDERE bestanden uit dezelfde toewijzing, maar dat helpt alleen als de te
testen module toevallig in diezelfde toewijzing wordt geschreven. Bij
"schrijf tests voor de bestaande functie X" is er geen ander bestand, bleef
dat blok leeg, en zag de Builder de code alsnog nooit — precies wat er bij
PR #29 en #30 gebeurde.

**Wat er is gebouwd.** Een nieuwe, dependency-vrije module
`context-resolver.ts` met alle beslissingen erin, en één async functie
`resolveTestContext()` in builder-runtime.ts die de GitHub-aanroepen doet.
Bij een testbestand `x.test.ts` wordt `x.ts` in dezelfde map gezocht, volledig
gelezen, en daarbij elk bestand dat die module direct importeert — één laag
diep, niet dieper. De naamregel haalt telkens één punt-segment van achteren
af, zodat `builder-runtime.mission-branch.test.ts` bij `builder-runtime.ts`
uitkomt. Bovenaan de opdracht staat een contextmanifest: dit mag je
schrijven, dit heb je gelezen, dit heb je NIET gezien, en alles wat je
gebruikt moet letterlijk in die bestanden voorkomen.

**Afwijking van het oorspronkelijke plan.** Daar stond "geen path-aliassen"
om V1 simpel te houden. Bij het lezen van de codebase bleek dat averechts:
dit project importeert 245 keer via `@/...` tegenover 126 keer relatief, dus
zonder aliassen zou het bewijs grotendeels leeg blijven. Ze zitten er dus wél
in, en dat is geen nieuw risico: `scripts/verify-imports.mjs` past dezelfde
omzettingsregels al maandenlang betrouwbaar toe, en `resolveImportSpecifier()`
volgt die regels.

**Twee dingen die stilzwijgend fout gingen en nu niet meer kunnen.** Het
stijlvoorbeeld was het alfabetisch eerste testbestand van de héle repository —
zelden iets met de opdracht te maken; nu er een uit dezelfde map. En er is een
budget van acht bewijsbestanden en 120.000 tekens, waarbij wat níet meepast
mét reden in het manifest komt te staan. Dat laatste is de les van globals.css:
een halve weergave mag nooit als "de volledige inhoud" gepresenteerd worden.

Vindt de resolver de module onder test niet én schrijft de toewijzing zelf
geen broncode, dan stopt hij met `INSUFFICIENT_CONTEXT` in plaats van te
gokken. De API-route hoefde daar niets voor: `publicErrorCode()` leest sinds
stap 5 elk `code`-veld generiek uit, precies zoals de toelichting daar
destijds al beschreef.

**Verificatie.** 26 tests voor de resolver (naamregel, importomzetting
inclusief `@/` en index-bestanden, stijlvoorbeeld, budget, manifest) en 8
tests voor het ophalen met een nagebootste GitHub, waaronder beide
INSUFFICIENT_CONTEXT-paden. Die 26 zijn tijdens het bouwen ook echt
uitgevoerd (getranspileerd en gedraaid), niet alleen gecompileerd; één faalde
daarbij — de zoekregel voor het stijlvoorbeeld klom wel omhoog maar keek per
stap alleen naar bestanden direct in die map.

Onderweg gevonden: `verify-imports.mjs` leest élk bestand op importregels,
inclusief voorbeeldcode binnen tekststrings. De eerste versie van de tests
maakte CI daarmee rood met negen verzonnen "ontbrekende" imports. Opgelost
door voorbeeldregels uit losse stukken op te bouwen, met de reden erbij in
beide bestanden.

**Live bewezen.** Missie "Tests voor de state machine van Mission Engine V2"
(PR #40, gemerged): een opdracht van exact de soort die zes keer misging, met
de functienamen bewust NIET in de opdracht genoemd. Het resultaat gebruikte de
echte namen `canTransitionMission` en `assertMissionTransition`, de letterlijke
foutmelding `Ongeldige mission-transitie: X -> Y`, de werkelijke overgangstabel
(acht losse beweringen nagerekend), de verborgen regel dat een overgang naar
dezelfde status altijd wordt geweigerd, en `MISSION_STATUSES` uit `mission.ts` —
dat laatste is het bestand dat de bewijslaag erbij pakte omdat state-machine.ts
het importeert, dus de tweede laag deed ook wat hij moest doen. Alle acht
succescriteria op GEHAALD, CI groen, in één keer.

Eerlijk erbij: dit is één missie. Het patroon van zes mislukkingen is
doorbroken, maar één geslaagde run bewijst niet dat het altijd goed gaat.

QA merkte terecht op dat het gegenereerde bestand geen afsluitende
regelovergang heeft (nagekeken: klopt, het eindigt op `});`). Restpunt voor
een latere opruimronde. **Inmiddels geen incident meer**: bij PR #54
(7 september 2026) viel QA over exact hetzelfde. Twee van de twee door de
Builder geschreven testbestanden missen die regelovergang, dus dit is een
vast patroon van de schrijfroutine en niet iets van één missie. Het hoort
daarom niet thuis in een opruimronde maar in de Builder zelf: een afsluitende
`\n` afdwingen bij het wegschrijven van een bestand. QA's tweede suggestie — de hardgecodeerde
foutteksten in de test koppelen aan de formulering in state-machine.ts — is
bewust NIET overgenomen: dan vergelijkt de test de code met zichzelf en kan
hij per definitie niet meer merken dát die tekst verandert.

### Stap 11 — Technische herstellus bij een mislukte CI
De CI-controle bestond al sinds stap 7: QA weigert een oordeel zolang de CI
niet klaar is, en de Director weigert te mergen bij rood. Wat ontbrak was het
hérstel — bij rood stopte de missie en stapte de eigenaar in. Dat is de
correctielus die deze stap wegneemt.

**Afwijking van het oorspronkelijke plan.** Dat plan wilde de pull request pas
openen zodra de CI groen was, met een nieuwe missiestatus
`AWAITING_VERIFICATION` en een push-trigger in `ci.yml`. Daar is bewust van
afgezien: het vraagt een nieuwe status door het hele missiemodel, een
handmatige wijziging in een workflowbestand dat de agents nooit kunnen
repareren, en het geeft een reëel risico dat een missie eeuwig blijft hangen
wanneer die trigger niet precies matcht. De gekozen opzet laat de pull request
gewoon meteen opengaan — CI draait daar al op, en draait automatisch opnieuw
bij elke nieuwe commit. Geen nieuwe status, geen workflowwijziging, geen
kans op vastlopen. Wat we ervoor inleveren: de pull request is korte tijd
zichtbaar rood. Dat is cosmetisch; hij wordt niet gemerged zolang hij rood is,
en de herstelcommits maken de geschiedenis juist beter leesbaar.

**Deel 1 — de echte foutmelding.** De app kende alleen de NAAM van een
gefaalde controle ("CI / Typecheck & import-check"). Daar valt niets mee te
repareren; een Builder die alleen dát hoort gaat opnieuw invullen wat hij niet
weet — precies de fout die stap 10 wegnam. `ci-failure-report.ts` (zonder
netwerk, apart getest) zet de ruwe gegevens om in één verslag: de gefaalde
controle, de door GitHub aangewezen bestanden en regels, en de relevante
regels uit het taaklogboek, ontdaan van tijdstempels en installatieruis.
`ci-failure-source.ts` doet het ophalen. Het verslag verschijnt zowel in het
QA-oordeel als in de melding van de Director.

Elk weggelaten stuk logboek wordt gemarkeerd met `[...]`, ook aan het begin —
dat kwam uit een test die faalde: de eerste versie liet honderden regels vóór
de fout stilzwijgend weg, waardoor het leek alsof het logboek bij de foutregel
begon. Dezelfde stille misleiding als het afkappen van globals.css. Ontbreekt
het logboek helemaal, dan staat er letterlijk dát het mist en waarom.

Vereist eenmalig de permissie **Actions: Read** op de GitHub App (bovenop
Contents, Pull requests en Checks uit stap 6), inclusief het goedkeuren van
het permissieverzoek op de installatie.

**Deel 2 — de herstellus.** Vóór alles wat het taalmodel doet kijkt de
Director of de CI van deze missie rood staat. Zo ja, dan zet hij zonder
tussenkomst van een LLM een herstelopdracht uit met het foutverslag erbij, als
nieuwe commit op dezelfde missiebranch (sinds stap 9 veilig). Bewust géén
LLM-beslissing: of code compileert is objectief vast te stellen, en een LLM
heeft eerder bewezen een falende typecheck niet als blokkerend te herkennen.

De herstelopdracht bevat de lijst bestanden die de missie tot nu toe wijzigde
met de instructie zich daartoe te beperken, en het expliciete verbod om een
test of controle uit te zetten om de CI groen te krijgen ("een groene CI die
zo bereikt is telt als mislukt"). Pogingen worden geteld op een eigen veld
`kind` op de toewijzing, niet op de bewoording van de opdrachttekst — er is
een test die aantoont dat een missie waarvan de tekst toevallig op een
herstelpoging lijkt, niet meetelt. Drie pogingen, daarna
`TECHNICAL_REPAIR_EXHAUSTED` met uitleg.

**Regressietest D — geslaagd.** Missie "Tests voor het opknippen van
gesprekken" (PR #43). Nadat de Builder klaar was is er met de hand een
typefout op de missiebranch gezet. Resultaat: de Director sloeg QA en mergen
over en zette meteen een herstelopdracht uit — *"herstelpoging 1 van 3. Dit is
een vaste regel, geen afweging van het taalmodel"* — waarna de Builder de fout
oploste op dezelfde branch en de CI groen werd. De commitgeschiedenis van #43
vertelt het verhaal zelf: twee rode commits, dan
`Director: HERSTELOPDRACHT (poging 1 van 3)` en groen.

Niet vastgesteld: óf het GitHub-logboek daadwerkelijk in die herstelopdracht
zat, of dat de Builder de fout uit het bestand zelf afleidde. De
opdrachttekst wordt wel opgeslagen op de toewijzing maar is nergens zichtbaar
in de app. Restpunt.

**Wat dezelfde test blootlegde, en waarom stap 12 nu bewezen nodig is.** Na
het herstel liep de missie vast op één succescriterium, en daar bleef de
Director de Builder op terugsturen: drie extra toewijzingen, zeven commits,
kosten van 12 naar 63 cent, zonder plafond. Drie oorzaken:

1. QA krijgt bij een pull request die alleen een testbestand wijzigt
   uitsluitend dát testbestand. Hij kon daardoor niet nagaan of
   `CHUNK_LENGTH` geëxporteerd is (dat is zo) en keurde het criterium af als
   "niet te controleren". Exact de blinde vlek die stap 10 aan de Builderkant
   oploste.
2. De inhoudelijke herstellus heeft géén pogingteller, in tegenstelling tot de
   technische. Hij loopt door tot de eigenaar ingrijpt. Dit is het eerste wat
   stap 12 moet dichtzetten.
3. De Director vroeg de Builder om "bewijs van groene runs" te leveren. De
   Builder kan niets uitvoeren; hij schrijft alleen bestanden. Zo'n opdracht
   kan per definitie niet slagen.

Bijvangst over het opstellen van missies: het criterium was geformuleerd als
"npm run typecheck en npx vitest run zijn beide groen". Dat gaat over een
commando dat lokaal draait en dat QA niet kan waarnemen. Formuleer zoiets als
"de CI-controle op de pull request slaagt" — dat is wél zichtbaar. Ook
opvallend: bij een falende CI worden alle criteria hard op NIET GEHAALD gezet,
maar een geslaagde CI wordt nergens als positief bewijs gebruikt, terwijl dit
criterium er letterlijk over ging.

De missie is met de hand afgerond: PR #43 zelf gemerged (CI groen, werk in
orde) en de missie daarna geannuleerd, omdat een missie met één afgekeurd
criterium niet op voltooid kan komen.

### Stap 12 — Plafond op de inhoudelijke lus, en bewijs voor QA
Alle drie de onderdelen kwamen uit regressietest D (zie stap 11), niet uit een
vermoeden.

**Deel 1 — het plafond.** De inhoudelijke herstellus had er geen: bleef QA een
criterium afkeuren, dan stuurde de Director de Builder eindeloos terug. Nu
dezelfde opzet als de technische lus uit stap 11: een vaste poort vóór het
taalmodel, met een eigen teller (`semantic-repair.ts`, kind
`SEMANTIC_REPAIR`), maximaal twee pogingen, daarna
`SEMANTIC_REPAIR_EXHAUSTED`.

Twee en niet drie, bewust: bij de technische lus staat vást dat er iets stuk
is, hier gaat het om een oordeel. Blijft dat na twee gerichte rondes staan,
dan is het even waarschijnlijk dat het bezwaar niet klopt of dat het criterium
niet te bewijzen is als geformuleerd. De melding bij het plafond noemt daarom
alle drie de mogelijkheden en niet alleen "QA heeft gelijk".

De opdrachttekst wordt door de code opgesteld, niet door het taalmodel. Daarin
staat expliciet dat de Builder QA mág tegenspreken wanneer het bezwaar
aantoonbaar niet klopt (anders is de snelste weg naar een tevreden QA het
slopen van correcte code), dat hij nooit een test mag verzwakken, en dat hij
zelf niets kan uitvoeren — vraagt een criterium daarom, dan moet hij dat
zeggen in plaats van te doen alsof. Dat laatste lost het derde gebrek uit test
D bij de bron op: de Director vroeg de Builder toen om "bewijs van groene
runs", wat die per definitie niet kan leveren.

**Deel 2 — de bewijsbundel voor QA.** QA kreeg alleen de gewijzigde bestanden
van een pull request. Bij een test-only wijziging zag hij de module niet waar
die tests tegenaan praten — dezelfde blinde vlek als de Builder vóór stap 10,
en bij test D leidde dat tot een afkeuring op iets dat gewoon in orde was. QA
krijgt nu referentiebestanden mee: de module onder test plus haar directe
imports, opgezocht met exact dezelfde resolver uit stap 10. Er staat
nadrukkelijk bij dat die bestanden geen onderdeel van de wijziging zijn en
niet beoordeeld moeten worden, en wat er niet in paste wordt met reden
benoemd.

Daarnaast telt een geslaagde CI nu mee als positief bewijs. Dat was scheef:
een falende CI zette alle criteria hard op niet-gehaald, maar een geslaagde
werd nergens gebruikt — terwijl het afgekeurde criterium bij test D letterlijk
over de CI ging. Bewust geen automatisch GEHAALD: het blijft QA's oordeel of
het criterium ermee gedekt is; wat verandert is dat hij het gegeven heeft.

**Live bewezen.** Missie "Tests voor de labelfuncties van de Mission Engine"
(PR #48): QA gebruikte de CI-uitslag als bewijs ("De automatisch vastgestelde
GitHub CI-uitkomst is GESLAAGD"), waar hij bij test D op dezelfde soort vraag
nog "niet te controleren" antwoordde. Het plafond hield: twee pogingen, daarna
de melding met de drie mogelijke oorzaken.

**Wat die missie blootlegde.** Bij de tweede poging had de Builder het
criterium wél gehaald — de kostenassertie vergelijkt numeriek na het
verwijderen van opmaak — maar QA bleef afkeuren. Twee oorzaken, allebei
leerzaam:

1. Het criterium was negatief geformuleerd ("er wordt nergens hard vergeleken
   met een tekst als 0,50"). Een afwezigheid over een heel bestand bewijzen is
   precies waar een beoordelaar aan blijft twijfelen. Formuleer criteria
   positief en aantoonbaar.
2. QA kan maar twee dingen zeggen: gehaald of niet gehaald. Twijfel en
   afkeuring zijn niet hetzelfde, maar het systeem kent dat verschil niet — zie
   stap 12b.

Bijvangst, live gevonden en apart gerepareerd: de Builder kon hetzelfde
bestand twee keer in één plan zetten, waarna de tweede schrijfactie bij GitHub
strandde op 422 ("sha wasn't supplied"). De bestandenlijst wordt nu
genormaliseerd (`./x`, `/x` en `x` zijn hetzelfde bestand) en ontdubbeld
vóórdat de grens van acht bestanden geteld wordt.

### Tussentijds — De Director baseert zich op de actuele stand
Gevraagd welke taken aandacht nodig hadden, gaf de Director een lijst die
grotendeels achterhaald was: missies sluiten die al gesloten waren, tellers
controleren die diezelfde dag verwijderd waren, lessen vertalen naar
controles die al gebouwd waren. Hij zei het zelf in zijn eerste zin: "Ik kan
de actuele Firestore-status hier niet zelf vaststellen."

Dat was letterlijk waar en toch misleidend: hij kán projectbestanden lezen en
de roadmap staat in de repository. Hij deed het alleen niet uit zichzelf.
Dezelfde fout als bij de Builder vóór stap 10 en QA vóór stap 12, nu bij de
Director — en dezelfde oplossing: het bewijs vóór hem neerleggen in plaats van
hopen dat hij erom vraagt.

Bij elk chatbericht gaan nu automatisch mee: de kopjesstructuur van
docs/roadmap.md (met per kop of hij onder Voltooid staat of onder de
voorstellen) en de twintig meest recent bijgewerkte missies met hun status.
Het aantal openstaande missies wordt door de code geteld, niet door het model.
Er staat expliciet bij dat dit blok wint van zijn eigen herinnering, met de
reden erbij: hij ziet maar twintig berichten. Bewust de index en niet de
volledige roadmap — die is bijna 40 KB; voor details kan hij het bestand
alsnog opvragen.

Direct effect, gemeten met dezelfde vraag: "Volgens de actuele projectstand
staan er momenteel geen openstaande missies", en de juiste eerstvolgende
roadmapstap. Neveneffect om te onthouden: zodra een model op een document
wordt gebaseerd, wordt de nauwkeurigheid van dát document de zwakste schakel —
deze roadmap moet dus bijgewerkt zijn vóórdat de Director erover adviseert.

### Tussentijds — Signalen die zichzelf bijwerken, en geen valse geruststelling
Het vorige punt eindigde met een waarschuwing in een bijzin. Elroy zag er
meteen het echte probleem in: "als ik hier stop met jou om de roadmap te
updaten, dan zal de director altijd antwoorden: nee, niks heeft aandacht
nodig. Dat is gewoon manipulatie eigenlijk." Terecht. Een blok dat stiller
wordt naarmate er minder wordt bijgehouden, klinkt het meest geruststellend
precies wanneer er het meeste ongemerkt blijft liggen — en de instructie
"behandel dit blok als de waarheid" maakte die stilte ook nog gezaghebbend.

Twee dingen veranderd. Ten eerste staan er nu drie signalen bij die niemand
hoeft op te schrijven, opgehaald bij elk chatbericht
(`project-signals.ts`, de ophaallaag; `project-state.ts` blijft puur):

- **openstaande pull requests op GitHub**, met hoe lang ze al openstaan — een
  PR die blijft hangen is onafgemaakt werk, wat de roadmap er ook over zegt;
- **kennisitems die op beoordeling wachten** in Firestore;
- **de ouderdom van docs/roadmap.md**: wanneer het bestand voor het laatst is
  aangeraakt en hoeveel commits er sindsdien zijn geland. Vanaf tien commits
  zegt het blok zelf dat de roadmap achterloopt en dat er werk is gedaan dat
  er niet in beschreven staat.

Ten tweede is de instructie omgedraaid. Het blok is nog steeds gezaghebbend
over wat het lát zien, maar zegt er nu expliciet bij dat het **geen volledige
lijst** is van wat aandacht nodig heeft, en dat "er is niets" nooit uit een
leeg blok mag volgen. "Dat kan ik niet vaststellen, en dit zou je moeten
bekijken" is een toegestaan antwoord; een geruststelling zonder grond niet.
Een mislukte ophaling wordt "onbekend" en nooit stilzwijgend "geen" — dat
onderscheid is in beide modules getest.

Wat dit niet oplost: de drie signalen dekken lang niet alles, en dat staat er
ook zo bij. Het verschil is dat het blok nu hardop toegeeft wat het niet weet,
in plaats van dat gat op te vullen met een oud document.

### Tussentijds — De Director las zijn eigen besluit stuk, en wat dat kostte
Een missie liep vast op "De Director gaf geen geldig besluit terug (kon het
antwoord niet als JSON lezen). Probeer het opnieuw." Het antwoord was 2953
tekens lang en volkomen geldige JSON. De extractiefunctie zocht altijd éérst
naar een markdown-codeblok en nam blind de inhoud daarvan. Dit besluit gíng
over codeblokken: in `nextAction` stond dat de Builder moest testen of een
antwoord "in markdown-codehekken (```json ... ```)" nog gelezen wordt. Die
hekken stonden dus middenin een JSON-tekstwaarde. De functie knipte
daartussenuit en hield `...` over.

**De fix.** Niet meer raden welke vorm het antwoord heeft, maar vier vormen
op volgorde proberen en de eerste nemen die daadwerkelijk te parsen is: kaal
JSON, JSON met tekst eromheen, de inhoud van een codeblok, en JSON binnen dat
codeblok. Kaal JSON wint altijd; een codeblok komt pas in beeld als het
antwoord als geheel onleesbaar is. Geverifieerd door het echte gelogde
antwoord er als invoer doorheen te halen, niet door erover te redeneren.

Onderweg meegenomen: de OpenAI-provider las `finish_reason` niet uit en zette
dus nooit `stopReason`, terwijl de Anthropic-provider dat al deed en zelfs
expliciet waarschuwt bij afkappen. Sinds de overstap naar OpenAI was een
afgekapt antwoord daardoor niet te onderscheiden van een model dat gewoon
geen JSON schreef. Gelijkgetrokken.

**Wat dit vooral kostte, en dat is de eigenlijke les.** Drie volledige
oplevercycli op één avond (21:02, 21:22, 21:38), waarvan twee overbodig.
Ronde 1 was een aanpassing op grond van de 300 tekens die de UI toonde van
een 2953 tekens lang antwoord — de oorzaak zat in het onzichtbare deel, en de
wijziging raakte hem niet. Ronde 2 was het logboek dat dat deel zichtbaar
maakte. Ronde 3 duurde vijf minuten, want toen stond de oorzaak er gewoon:
`naExtractie: '...'`. Met het logboek als eerste ronde was het in één keer
klaar geweest.

Elke oplevering kost de eigenaar uitpakken, typecheck, 300+ tests, branch,
commit, push, PR, merge, opruimen en een herstart van de dev-server. Daaruit
volgt een harde regel, die ook in de samenwerkings-skill is vastgelegd: faalt
er iets en is niet te zien waaróm, dan is de eerste wijziging er één die het
zichtbaar maakt — nooit een gok die als oplossing verpakt is. Volledige
foutmeldingen gaan naar het serverlogboek (een rode balk in de UI kan geen
drieduizend tekens tonen), en bewijs dat op de pc van de eigenaar staat wordt
zelf opgehaald in plaats van hem zijn eigen terminal in te sturen.

### Tussentijds — Zeven restpunten in één keer, en één diagnose gecorrigeerd
Op verzoek van Elroy ("snelste klaar") in één keer opgepakt in plaats van één
voor één, direct gebouwd (niet via de mission-loop, zelfde patroon als
eerdere restpunten). Vijf van de zeven zijn opgelost: de Builder dwingt nu
een afsluitende regelovergang af in plaats van erop te hopen
(`ensureTrailingNewline` in builder-runtime.ts); de opdrachttekst van een
toewijzing staat nu in het missievoortgangspaneel (rol, status, opdracht,
succescriteria, nieuwste eerst); de wachtrij- en afgewezen-lijst op de
kennispagina hebben nu allebei hun eigen, statusgefilterde Firestore-query
(`subscribeToKnowledgeByStatus`) in plaats van client-side te filteren uit
een op 250 begrensde algemene lijst — vraagt een nieuwe samengestelde index,
zie README; en een afgewezen kennisitem is nu zichtbaar (met het AI-advies
erbij) en in één klik terug te zetten naar de wachtrij.

Bij de dode CSS bleek de eigen diagnose bij nader onderzoek onjuist: de vier
genoemde klassen (-stats, -brain, -dashboard, -mission-list) hadden
grotendeels geen eigen CSS-regel om te verwijderen, en `.command-center-intro`
bleek nog gewoon in gebruik door de missions-v2-pagina — verwijderen had die
kapotgemaakt. De daadwerkelijk dode CSS was een ander blok
(`.command-center-columns` en alles eronder, een niet meer gebruikte
tussenstap in de Command Center-layout) — gevonden door van elke genoemde
selector na te gaan of hij nog ergens als className voorkomt, niet door de
oorspronkelijke restpunt-tekst te vertrouwen. Les: dezelfde als bij de
JSON-bug hierboven, nu op kleinere schaal — een eerdere eigen diagnose is
een hypothese, geen gegeven, en verdient dezelfde verificatie als een
diagnose van iemand anders.

Bij het LLM-provider-restpunt bleek de helft van de klacht al opgelost: welke
provider actief is, staat al in het Systeemstatus-paneel
(`describeActiveChatModel`, eerder al gebouwd). Alleen het wisselen zelf kan
nog steeds alleen via `.env.local` + herstart — dat structureel oplossen (de
provider request-scoped maken in plaats van een module-level singleton op
basis van `process.env`) raakt elke aanroeper van `getChatProvider()` en is
geen "Klein" restpunt meer. Verplaatst naar Voorgestelde volgende stappen
hieronder, met de gecorrigeerde omschrijving.

De opruiming van oude branches is bewust niet meegenomen: dat is een
git-actie op GitHub, geen codewijziging, en hoort dus niet in dezelfde pull
request. **Inmiddels wel gedaan** (7 september 2026): 17 remote branches die
al in `main` zaten verwijderd (`git push origin --delete ...`), en lokaal 13
branches geprobeerd met `git branch -d` — 11 gingen direct (al gemerged),
2 (`pr-24-review`, `pr-26-review`) weigerden terecht en bleken lokale
kopieën van pull-requestbeoordelingen te zijn (via
`git fetch origin pull/<n>/head:pr-<n>-review`, ons vaste reviewpatroon) die
zelf nooit gemerged zijn — de inhoud blijft op GitHub staan, dus die zijn
daarna met `-D` verwijderd zonder risico.

**Nog een gevonden en gefixte regressie, in hetzelfde rondje.** Bij het
schrijven van de opdrachttekst-sectie (zie hierboven) is
`mission-progress-panel.tsx` bewerkt vanuit een kopie die al eerder deze
sessie in de sandbox stond, in plaats van eerst opnieuw van Elroy's D:-schijf
opgehaald — precies de stap die het device-sync-protocol in de
samenwerkingsskill voorschrijft. Op de échte, actuele repo was de
`mission`-prop van `MissionProgressPanel` inmiddels optioneel gemaakt (twee
paginas roepen het paneel zonder mission-prop aan); de oudere kopie had 'm
nog verplicht, en die versoepeling werd zo per ongeluk teruggedraaid.
`npx tsc --noEmit` (op verzoek gedraaid vóórdat dit als afgerond gold) ving
het meteen op met twee heldere fouten. Fix: één regel, de prop weer
optioneel. `npm test` was op dat moment al 321/321 groen — het probleem zat
dus specifiek in wat de test suite niet dekt (JSX-gebruik van een
component-interface), niet in gedragslogica. Les: dezelfde als bij de dode
CSS hierboven, en dus voortaan hard toepassen — een bestand dat al in de
sandbox staat is niet hetzelfde als een bestand dat vers van Elroy's schijf
is opgehaald, ook niet middenin dezelfde sessie.

### Stap 12b — QA mag twijfelen, en de eigenaar krijgt de vraag
Sloot de twee doodlopende paden die bij stap 12 al werden voorzien.

**QA kan nu drie dingen zeggen.** Naast GEHAALD/NIET GEHAALD bestaat nu
`UNDETERMINED` ("niet vast te stellen") als eigen, eerlijke uitkomst per
succescriterium (`CriterionStatus` in `mission.ts`) — voor het geval de
benodigde informatie simpelweg ontbreekt in wat QA kreeg (bijvoorbeeld:
gedrag dat alleen door daadwerkelijk uitvoeren is vast te stellen). De
QA-prompt is expliciet: dit is geen kortere weg langs een lastig oordeel —
twijfel over kwaliteit blijft gewoon NIET GEHAALD. Een falende CI blijft
alles hard op NIET GEHAALD zetten, ook een `UNDETERMINED`-oordeel: een rode
build is een sterker gegeven dan "ik kan het niet vaststellen".

**De WAITING_FOR_OWNER-lus is afgemaakt.** `engine.recordOwnerInput()` bestond
al, maar niets riep hem aan: geen API-actie, geen knop. Een missie die er
belandde kon alleen nog geannuleerd worden. Nu:
- De Director stelt de vraag (`REQUEST_OWNER_INPUT`) in twee vaste, niet
  taalmodel-afhankelijke gevallen — dezelfde discipline als de herstellussen
  uit stap 11/12: (1) QA kon een criterium niet vaststellen, of (2) het
  inhoudelijke herstelplafond uit stap 12 (`MAX_SEMANTIC_REPAIR_ATTEMPTS`) is
  bereikt. Situatie 2 eindigde vroeger in een harde `SEMANTIC_REPAIR_EXHAUSTED`
  -stop; nu in een vraag.
- De vraag bevat het criterium, de twijfel/reden van QA, én — nieuw —
  het laatste weerwoord van de Builder zelf (`MissionAssignmentRecord.
  resultSummary`, sinds deze stap bij elk rolresultaat bewaard, want Mission
  Engine V2 hield de inhoud van een RoleResult daarvoor nergens doorzoekbaar
  vast).
- Een nieuwe API-actie (`answer-owner-input`) roept `engine.recordOwnerInput()`
  eindelijk aan. Ging de vraag over een specifiek criterium, dan zet het
  antwoord van de eigenaar (gehaald/niet gehaald + een reden) dat criterium
  direct — de reden wordt bewaard als `lastEvaluationNote`, exact zoals bij
  een QA-oordeel.
- Het paneel "Director & uitvoering" toont de vraag, met een keuzerondje
  gehaald/niet gehaald (verplicht wanneer de vraag aan één criterium hangt)
  en een verplicht redetekstveld.

Bewust géén generieke "QA overrulen"-knop: dit maakt alleen de twee
hierboven genoemde, specifieke doodlopende paden af. De eigenaar blijft de
opdrachtgever, QA een adviseur — niet andersom.

Nieuw bestand `owner-clarification.ts` (met eigen tests) bundelt de
tekstopbouw voor de vraag, apart van de GitHub- en LLM-aanroepen in
`director-runtime.ts` — dezelfde scheiding als bij `technical-repair.ts` en
`semantic-repair.ts`, en om dezelfde reden: zo blijft dit zonder netwerk
testbaar.

### Stap 13 — The Dost Council V1 (dun)
Een nieuwe knop "Vraag de Raad" naast de gewone verstuurknop in de
Director-chat — precies de "eerste plek" die bij het voorstel voor deze stap
al was vastgelegd, en verder niets: geen eigen pagina (de "Dost Council" in
de zijbalk toont nog steeds "GEPLAND — stap 13", bewust ongewijzigd), geen
wijziging aan de Builder- of QA-rol.

**Het protocol precies zoals vastgelegd.** Ronde 1: beide providers
(Anthropic en OpenAI, via een nieuwe `getCouncilProviders()` in
model-router.ts die — anders dan `getChatProvider()` — altijd allebei
tegelijk teruggeeft, met een duidelijke fout wanneer een sleutel ontbreekt in
plaats van stilzwijgend met één model verder te gaan) krijgen dezelfde vraag
onafhankelijk en parallel, zonder zicht op elkaar. Ronde 2: elk lid krijgt
uitsluitend de ronde-1-analyse van het ANDERE lid te lezen — nooit welke
provider erachter zit — en moet zich afsluiten met een expliciete
`<oordeel>EENS</oordeel>` of `<oordeel>ONEENS</oordeel>`-tag. Ronde 3 is
bewust GEEN derde LLM-aanroep: de code telt simpelweg op of BEIDE leden EENS
zeiden (`council-service.ts`); een ontbrekende of onleesbare tag telt als
ONDUIDELIJK en dus nooit als instemming, dezelfde eerlijke-twijfel-discipline
als QA's UNDETERMINED uit stap 12b. Bij onenigheid toont de chat beide volle
standpunten en de kritiek erop naast elkaar — geen samengevoegd advies dat de
onenigheid zou wegpoetsen.

**Eigen, dunnere bewijslaag, met opzet.** De raad hergebruikt niet de
volledige `sendChatMessage`-pijplijn van de Director-chat (geen semantisch
Second Brain-geheugen, geen `<workspace-read>`-lus, geen
`<create-mission>`-afhandeling) — wel dezelfde "projectstand" die de
Director als eerste blok ziet (roadmap, recente missies, de zelf-bijwerkende
signalen uit project-signals.ts). Genoeg gegronde context voor een
strategische vraag, zonder de zwaardere onderdelen van de Director-chat te
dupliceren.

**Eerste echte sessie, dezelfde dag als opgeleverd.** Gevraagd of stap 14 of
stap 17 als volgende voorrang moest krijgen, kwamen beide leden in ronde 1
onafhankelijk tot een tegenovergestelde volgorde, en bleven het in ronde 2 —
na elkaars argumenten gelezen te hebben — inhoudelijk oneens over hoe hard
die volgorde staat (`agreement: false`). Geen synthetisch advies dus, maar
precies het bedoelde resultaat: twee onderbouwde, tegengestelde standpunten
in plaats van een gegokt gemiddelde. Terzijde signaleerde één lid daarbij
zelf dat deze roadmap op dat moment nog achterliep op de code (deze
paragraaf lost dat op) en dat er kennisitems wachten op beoordeling en
meerdere testmissies zijn geannuleerd — geen geverifieerde diagnose, wel het
soort signaal dat de raad juist moet opleveren.

Stopcriterium, ongewijzigd vastgelegd bij het voorstel voor deze stap: als de
raad na tien sessies geen enkele keer een besluit heeft veranderd of een fout
heeft gevangen die één model miste, gaat de raad er weer uit. Geschatte
kosten per sessie: rond de $0,15 bij de bewijsomvang van deze V1 (zie de
eerste sessie hierboven), oplopend zodra er volledige bronbestanden in
zitten. Kosten blokkeren nooit, maar worden wel getoond (zie de kostenregel
onderaan elk raadsantwoord).

### Stap 14 — Productie-hosting
The Dost Matrix staat online op Vercel (project "the-dost-matrix" onder
Elroy's eigen Vercel-team), gekoppeld aan de GitHub-repository met scoped
toegang (alleen deze repository geautoriseerd, zelfde principe als het
fine-grained GitHub-token). Alle omgevingsvariabelen zijn overgezet van
`.env.local` naar Vercel's project-instellingen (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`,
`GITHUB_APP_PRIVATE_KEY`, de zes `NEXT_PUBLIC_FIREBASE_*`-variabelen); waar
lokaal `FIREBASE_SERVICE_ACCOUNT_FILE` (een bestandspad) werd gebruikt, staat
in Vercel in plaats daarvan `FIREBASE_SERVICE_ACCOUNT_KEY` met de volledige
JSON-inhoud, omdat een bestandspad in de hostingomgeving niet bestaat.

Bevestigd via Elroy's eigen test: inloggen op de gehoste omgeving toont
Command Center met de volledige bestaande geschiedenis (480 berichten,
inclusief eerdere raadsessies), en het Systeemstatus-paneel toont
LLM-provider, GitHub App en Firestore alle drie als OK vanuit de gehoste
omgeving zelf — niet alleen lokaal. Dit is de harde randvoorwaarde voor stap
15 hieronder: zonder hosting bestaat de Matrix niet meer zodra Elroy's eigen
laptop uit staat, ongeacht hoe goed autonome triggers of signoff gebouwd
zijn.

### Stap 15 — Autonome missie-triggers met geautomatiseerde signoff
(voorheen stap 21; herzien op 12 september 2026) Twee delen, allebei live
bewezen op 13 september 2026 met de missie "Testmissie autonome voortgang"
(PR #58, `formatCents`).

**Deel 1 — geautomatiseerde signoff.** Een needs-signoff pull request wacht
niet meer automatisch op Elroy. Hij krijgt eerst een tweede, onafhankelijke
modelbeoordeling die de daadwerkelijke diff leest
(`reviewPullRequestForAutomatedSignoff` in automated-signoff.ts). Keurt die
oprecht goed, dan mergt de Director zelf. Daaromheen liggen de bestaande
vangnetten ongemoeid: alle succescriteria PASSED, CI groen, en een harde
categorie die altijd naar Elroy escaleert ongeacht wat de beoordeling zegt
(`findHardEscalationReason`: secrets/tokens, GitHub-workflows, authenticatie,
Firebase-configuratie, en elke bestandsverwijdering).

**Deel 2 — autonome triggers.** `advanceMissionsForOwner`
(autonomous-advance.ts) loopt elke voort-te-zetten missie langs via herhaalde
`runDirectorStep`/`executeRoleAssignment`-aanroepen, begrensd door een
wandklok-deadline en een stappenplafond per missie, met per missie een eigen
try/catch zodat één vastgelopen missie de rest niet blokkeert. De route
`/api/missions/v2/advance` stelt dat beschikbaar achter een gedeeld geheim
(`MISSION_ADVANCE_SECRET`, vergeleken met `timingSafeEqual`), omdat GitHub
Actions geen Firebase ID-token kan produceren. Een GitHub Actions-workflow
roept die route elke tien minuten aan — bewust GitHub Actions en niet Vercel
Cron, omdat Vercel's Hobby-plan maar één keer per dag toestaat met tot 59
minuten afwijking.

**Wat de live test heeft opgeleverd, inclusief wat er misging.** De missie
bleef eerst negen uur hangen zonder zichtbare reden. Twee oorzaken, gestapeld.
De eerste was banaal maar leerzaam: de Anthropic-credits waren op, waardoor
elke LLM-aanroep faalde met status 400 — en `advanceMissionsForOwner`'s
per-missie try/catch slikte die fout elke cyclus stil in. Zichtbaar werd het
pas toen Elroy zelf handmatig op "volgende stap" klikte. Dat is een reëel gat:
een providerfout tijdens een automatische run is nu nergens te zien behalve in
de GitHub Actions-logs. Bewust nog niet gerepareerd — eerst vaststellen of het
in de praktijk vaker gebeurt dan deze ene keer.

De tweede oorzaak was géén fout maar het systeem dat deed wat het moest doen:
PR #58 raakte twee bestanden (de functie plus zijn test), wat per definitie
needs-signoff is. De geautomatiseerde beoordeling hééft gedraaid, heeft de
diff gelezen, en koos ESCALEREN — niet omdat de wijziging fout was, maar omdat
ze twee onbesproken gedragskeuzes zag (ongeldige invoer die stil als "€ 0,00"
wordt getoond, en asymmetrische afronding bij halve centen). Precies de
"eerlijke twijfel"-discipline waarvoor deel 1 is gebouwd. Elroy heeft daarna
zelf beoordeeld en gemergd.

Belangrijk voor de verwachting bij toekomstige nachtelijke runs: een
meer-dan-één-bestand pull request blijft NIET structureel op Elroy wachten —
de tweede beoordeling mag hem zelfstandig mergen. Hij komt alleen bij Elroy
terecht wanneer die beoordeling zelf twijfelt, of wanneer de wijziging in de
harde escalatiecategorie valt.

### Stap 17 — Director Evidence Upgrade
(voorheen stap 15) Live bewezen op 13 september 2026 met de missie "Voeg
utility truncateMiddle toe" (PR #59).

Tot deze stap zag de Director van elke eerdere toewijzing drie dingen: welke
rol, welke status, en de opdrachttekst die hij er zélf ooit aan had
meegegeven. Niet wat die rol had opgeleverd, niet of er een pull request uit
was gekomen, niet of de CI groen was. Hij besliste dus over de volgende stap
op grond van zijn eigen vorige opdracht plus een statuswoord.

Sinds deze stap krijgt hij er drie dingen bij (zie director-evidence.ts): de
resultaatsamenvatting van elke toewijzing, de soort toewijzing (zodat een
herstelpoging herkenbaar is), en de stand van de pull request — welke
bestanden geraakt zijn en wat de CI zegt, gepind aan de exacte commit-SHA.

Drie grenzen eromheen, alle drie bewust. Geen diff in de prompt: beoordelen of
code klopt is het werk van QA en de geautomatiseerde signoff, en een volledige
diff zou de beslissing verdrinken én bij elke stap opnieuw betaald worden.
Maximaal de zes recentste toewijzingen, met een regel erbij hoeveel er zijn
weggelaten — anders groeit de prompt juist bij een vastgelopen herstellus het
hardst. En fail-open bij een onbereikbare GitHub: dan beslist de Director met
minder bewijs in plaats van dat de missie stilvalt, dezelfde afweging als bij
budget dat nooit een missie mag blokkeren.

Het goedkoopste deel bleek al te bestaan: `resultSummary` stond sinds stap 12b
op elke toewijzing opgeslagen, maar werd nooit aan de Director doorgegeven.

**Bewijs uit de live test.** Bij de eerste beslissing schreef de Director: "Er
zijn nog geen toewijzingen geweest en er bestaat nog geen pull request. De
eerste stap is dus dat de builder de utility en de bijbehorende tests
daadwerkelijk aanmaakt in een PR. QA heeft pas zin zodra die PR er is en de CI
groen is." Dat hij wéét dat er nog geen pull request is, en QA daarvan laat
afhangen, kon hij vóór deze stap niet.

### Stap 18 (deel 1) — Doorkijken door doorverwijzingen
Live meegetest in dezelfde missie als stap 17 hierboven.

De bewijsbundel voor de Builder gaat één laag diep, en die grens blijft staan:
twee volle lagen worden al snel tientallen bestanden, en dan verdringt de
omvang de bruikbaarheid. Maar bij PR #54 lag het type dat je nodig hebt om een
mock-signatuur te beoordelen twee stappen verderop, met een bestand ertussen
dat zelf niets zei. De bundel was niet te klein — er zat een leeg doorgeefluik
in.

Twee gerichte ingrepen (zie `isBarrelModule` en `refineEvidenceImports` in
context-resolver.ts). Een barrel — een bestand dat vrijwel alleen doorverwijst
— wordt vervangen door waar het naar verwijst. Dat is geen extra laag maar een
ruil: bij gelijk budget strikt beter bewijs. En alleen voor type-imports komt
er één hop bij, begrensd op drie bestanden en achteraan in de volgorde, zodat
ze alleen meegaan als er ruimte over is. Gewone imports krijgen die hop niet:
types dragen de vorm die de Builder nodig heeft, gewone imports meestal niet.

Bij twijfel gebeurt er niets: staat er in een bestand behalve doorverwijzingen
ook iets inhoudelijks, dan blijft het gewoon bewijs. Het contextmanifest noemt
bij een vervangen barrel beide paden, want de Builder ziet de inhoud van het
doelbestand terwijl de rest van de codebase via de barrel importeert.

### Stap 18 (deel 2) — Gericht bewerken in plaats van overtypen
Live bewezen op 14 september 2026 met de missie "Voeg assignmentStatusLabel toe
aan mission-labels" (PR #60).

De Builder schreef een bestand tot deze stap door de VOLLEDIGE nieuwe inhoud
terug te geven, ook als er drie regels veranderden. Twee kosten, allebei
meegroeiend met de bestandsgrootte. De ene is geld en tijd. De andere is erger,
want stil: bij het overtypen van een lang bestand kan er onderweg iets
verdwijnen zonder enig signaal — precies wat met globals.css gebeurde. QA ving
dat toen af, maar dat was geluk, geen garantie.

Sinds deze stap wordt een BESTAAND bestand vanaf 2.000 tekens gericht bewerkt
(zie patch-edit.ts): de Builder zegt niet meer "dit is het hele bestand" maar
"vervang precies dit stuk door dat stuk". Wat hij niet noemt, blijft per
definitie staan. Nieuwe en kleine bestanden gaan ongewijzigd via het bestaande
pad — dat draait al maanden en daar viel niets te winnen.

Waarom zoeken-en-vervangen en geen unified diff: een echte diff vraagt van het
model dat het regels telt, en een diff met verkeerde regelnummers is precies het
soort fout dat je alsnog "ergens" toepast. Letterlijke tekst vraagt geen
telwerk.

Drie regels die niet onderhandelbaar zijn. Een zoekfragment moet exact één keer
voorkomen — nul keer betekent dat het model iets citeert wat er niet staat, meer
dan één keer betekent dat "dan maar de eerste" raden zou zijn. Alles of niets:
mislukt één blok, dan wordt er geen enkel blok toegepast, want een half bewerkt
bestand ziet er compleet uit. En een bewerking die het bestand zou leegmaken
wordt geweigerd.

Eén herkansing binnen dezelfde aanroep, met de precieze foutmelding erbij. Een
spatie te veel is zo rechtgezet, en dat scheelt een hele oplever-ronde. Blijft
het misgaan, dan faalt de toewijzing en komt hij via de gewone herstellus terug,
waar het zichtbaar is.

**Bewijs uit de live test.** De diff op `mission-labels.ts` was +13 −1: dertien
toegevoegde regels, en als enige rode regel de type-import die werd uitgebreid.
QA bevestigde het criterium letterlijk: "De diff van mission-labels.ts wijzigt
uitsluitend de type-import en voegt assignmentStatusLabel toe. missionStatusLabel,
formatMissionCost, riskLevelLabel en RISK_LEVELS blijven volledig ongewijzigd."
Vóór deze stap had de Builder alle 55 regels van dat bestand opnieuw uitgetypt.

Let op bij het beoordelen: de diff bewijst niet DAT er gericht bewerkt is (een
trouwe overtyping geeft dezelfde diff), maar wel dat er niets verdwenen is. Dát
het nieuwe pad liep, volgt uit iets anders: boven de 2.000 tekens bestaat er
geen terugval meer naar overtypen.

### Stap 18 — hoe de vier onderdelen ervoor staan
Deel 1 (13 september) en deel 2 (14 september) staan hierboven. De
oorspronkelijke stap 18 noemde vier dingen; daarvan zijn er twee af en staan er
twee open — niet één, zoals hier eerst stond.

Af: alias-, barrel- en typeresolutie (waarvan de alias-resolutie al in stap 10
bleek te zitten), en patch-gebaseerd schrijven. Open: een deterministische
signatuurcontrole, en begrensde lees-/zoektools. Die twee zijn bewust gesplitst
omdat alleen de tweede function calling nodig heeft — ze samen onder één kopje
zetten maakte de eerste onnodig groot. Zie stap 18 onder "Voorgestelde volgende
stappen".

Tekenend voor waarom dat deel bestaat: in zijn eigen PR-commentaar bij #60
schreef de Builder uit zichzelf dat hij de testuitvoering en de diff niet kon
verifiëren. Hij schrijft blind en hoort pas via de CI of het klopt. Dat hij die
beperking zelf benoemt in plaats van te doen alsof hij gecontroleerd heeft, is
precies de eerlijkheid die de rest van dit systeem ook aanhoudt — maar het
blijft een beperking.

### Eerste volledig autonome afronding — 14 september 2026
Bij PR #60 liep de hele keten voor het eerst van begin tot eind zonder
tussenkomst: Director, Builder, QA, en daarna een geautomatiseerde signoff die
de pull request zélf goedkeurde en zélf mergede. De missie kwam op VOLTOOID
zonder dat de eigenaar GitHub had aangeraakt.

Het verschil met de dag ervoor is leerzaam. Bij PR #59 escaleerde diezelfde
signoff, met twee argumenten die allebei klopten. Nu keurde hij goed. Dezelfde
code, dezelfde discipline — het verschil zat in de opdracht: bij #60 lagen de
randgevallen vooraf vast, bij #59 niet. De kwaliteit van de missieopdracht
bepaalt dus of de keten autonoom kan doorlopen, niet de strengheid van de
beoordelaar.

### Stap 24 — LLM-provider request-scoped, wisselbaar vanuit de app
Live bevestigd op 13 september 2026.

De aanleiding was diezelfde dag: de Anthropic-credits raakten op, en
omschakelen naar OpenAI kostte inloggen op Vercel, een omgevingsvariabele
weghalen, en opnieuw deployen. Dat weghalen brak meteen de Dost Council, die
beide sleutels tegelijk eist. Er was dus geen manier om alleen de Director te
laten wisselen.

Sinds deze stap staat de keuze per eigenaar in Firestore (`ownerSettings`) en
leest `getChatProvider()` hem per aanroep. Kies je OpenAI, dan mag de
Anthropic-sleutel gewoon blijven staan — en blijft de Council werken. Drie
keuzes: "auto" (het gedrag van vóór deze stap, Anthropic zolang die sleutel
bestaat), "anthropic" en "openai". Een provider waarvan de sleutel ontbreekt
staat uitgeschakeld in het scherm én wordt door de route geweigerd.

**Waarom een AsyncLocalStorage en geen extra parameter.** `getChatProvider()`
wordt op achttien plekken aangeroepen. De keuze als parameter doorgeven zou
achttien aanroepplekken plus alles eromheen laten veranderen zonder dat er
gedrag wijzigt. De routehandler zet de keuze nu één keer neer
(`withOwnerLlmSettings`), en alles daarbinnen leest dezelfde waarde.

De faalstand daarvan is zichtbaar gemaakt in plaats van verstopt: het
Systeemstatus-paneel toont nu "via instelling" of "via omgeving". Staat er
"omgeving" terwijl je een keuze hebt opgeslagen, dan mist ergens de wrapper.

Bewust NIET gebouwd: automatisch terugvallen op de andere provider bij een
fout. Dan gaat een missie halverwege stilletjes op een ander model verder en
legt het bewijs achteraf niet meer uit waarom een stap anders uitpakte. In
plaats daarvan zijn de foutmeldingen leesbaar gemaakt: "Anthropic-aanroep
mislukt met status 400" was negen uur lang het enige dat er stond, terwijl in
het antwoord van Anthropic zelf stond dat het tegoed op was. Dat wordt nu
meegelezen en doorgegeven.

### Wat de live test van 13 september bovendien opleverde

De testmissie (PR #59) liet drie dingen zien die het vastleggen waard zijn.

QA rekende na in plaats van af te vinken: hij zette alle vijf de criteria op
GEHAALD en vond daarbovenop een fout die niemand had opgemerkt — het
JSDoc-voorbeeld beloofde negen tekens waar de functie er tien teruggeeft.

De geautomatiseerde signoff escaleerde, met twee punten die allebei klopten:
datzelfde JSDoc-voorbeeld, en een gat in het invoercontract (`maxLength` is een
`number`, dus 5.5 kwam ongehinderd door de controle en leverde zes tekens op
terwijl de functie exact `maxLength` belooft). Beide zijn daarna in een gewone
commit rechtgezet. Let op de herkomst: dat gat zat in de missieopdracht, niet
in de Builder — de opdracht legde `maxLength < 5` vast maar niet dat het een
geheel getal moet zijn. Dezelfde soort omissie als bij PR #58, één laag dieper.

**Ontbrekend pad, gesignaleerd maar niet gebouwd.** Zijn alle succescriteria
GEHAALD en escaleert de signoff, dan kan de eigenaar alleen nog zelf mergen of
de missie annuleren. Er is geen weg terug naar de Builder om de gesignaleerde
punten te laten repareren: `ensureMissionPullRequestMerged` gooit NEEDS_SIGNOFF
vóórdat de Director een nieuw besluit mag nemen. Bij een klein punt is
zelf-mergen prima, maar bij een terecht bezwaar dat wél gerepareerd moet
worden, bestaat die route nu niet.

### De CI-poort stond open door een race — 14 september 2026

Gevonden bij het uitwerken van stap 18 (deel 4), en de reden dat die stap
kleiner uitviel dan gepland: het echte gat zat niet in wat er ontbrak, maar in
wat er al was en niet werkte.

Op papier was de CI-poort dicht. QA weigert te oordelen zolang checks nog lopen
(`state === "pending"`, qa-runtime.ts), de Director weigert te mergen bij een
rode CI (`planMissionRepair`, director-runtime.ts), en de technische herstellus
(stap 11) stuurt de Builder terug met de échte foutmelding. Drie controles,
allemaal aanwezig, allemaal getest.

In de autonome lus stond hij toch open. `advanceSingleMission` doet tot 25
stappen in één aanroep, achter elkaar. De Builder committeerde en opende de
pull request, en een paar seconden later nam de Director alweer het volgende
besluit — op een moment dat GitHub nog geen enkele check-run voor die commit
had geregistreerd. `getCombinedCheckStatus` geeft dan niet "pending" terug maar
"none", en "none" betekent daar bewust "deze repository heeft geen CI", een
toestand die nooit mag blokkeren.

Het gevolg: QA beoordeelde code die nog nooit gecompileerd was, en kon alles op
GEHAALD zetten. De merge-poort ving het verderop alsnog af, dus er is nooit
iets kapots gemerged — maar elke keer ging er een volledige QA-ronde verloren,
en in het missiepaneel stond ondertussen "alle criteria GEHAALD" op werk dat de
typecheck nog moest doorstaan. Precies het beeld waar `getCombinedCheckStatus`
ooit voor gebouwd is, terug via een achterdeur.

De oplossing is geen vierde controle maar een pauze: na een builder-toewijzing
stopt de lus met die missie en pakt de volgende tik het op. Tegen die tijd
heeft GitHub de check-run geregistreerd en afgerond, en werken de drie
bestaande controles zoals ze bedoeld zijn. Kosten: één extra tik per
builder-stap.

**De les, breder dan deze bug.** Alle drie de controles waren correct
geschreven en alle drie waren getest. Wat niemand had getest, was de volgorde
waarin ze in de autonome lus achter elkaar komen te staan. Een controle die
"nog onbekend" niet kan onderscheiden van "niet van toepassing", is geen
controle zodra iets hem snel genoeg passeert.

### Repository op publiek — 14 september 2026

Elroy heeft `The-Dost-Matrix/the-dost-matrix` van privé naar publiek gezet. De
aanleiding was rekenwerk, niet openheid: de tienminuten-tik van
`advance-missions.yml` is 144 runs per dag, en GitHub rondt elke job af naar
boven op een hele minuut. Dat is ~4.300 minuten per maand tegen 2.000
inbegrepen op het gratis plan. Halverwege elke maand zou Actions stilvallen —
en daarmee niet alleen de nachtelijke tik, maar ook de CI waar de merge-poort
hierboven volledig op steunt. Een besparing die het systeem blokkeert is geen
besparing.

Voor publieke repositories zijn Actions-minuten op standaard runners
onbeperkt gratis. Daarmee vervalt het plafond, blijft de tik op tien minuten
staan, en kosten extra CI-runs (de pauze hierboven, en alles wat later nog
komt) niets.

Vooraf gecontroleerd: `.env.local` staat in `.gitignore`, er staan geen
e-mailadressen of bedrijfsgegevens in `docs/` of `src/`, en Elroy heeft
geverifieerd dat er nooit een sleutelbestand in de Git-geschiedenis heeft
gestaan. Wat wél openbaar is geworden: de architectuur, deze roadmap, en de
Actions-logs (waarin GitHub geregistreerde secrets automatisch maskeert).

Er is bewust **geen** `LICENSE`-bestand toegevoegd. Zonder licentie geldt de
standaard — alle rechten voorbehouden — en dat is restrictiever dan elke
open-source licentie die gekozen zou kunnen worden. Publiek betekent hier
leesbaar, niet vrij te gebruiken. Wordt dit ooit alsnog gewenst, dan kan een
licentie op elk moment worden toegevoegd; het auteursrecht blijft bij Elroy.

### Stap 18 volledig af — 14 en 15 september 2026

Deel 3 en deel 4 zijn allebei gebouwd én live bevestigd. Dat ging niet in een
rechte lijn, en de omweg is leerzamer dan de bestemming.

**Deel 3 — mechanische importcontrole vóór de commit** (`export-check.ts`).
Controleert of elke geïmporteerde naam werkelijk ergens geëxporteerd wordt, en
zwijgt bij elke twijfel (pad buiten de repository, inhoud onbeschikbaar,
`export *` in het doelbestand). Nog vóór oplevering losgelaten op alle 211
bronbestanden, wat meteen een eigen bug opleverde: `src/core/workflows/types.ts`
begint met een onzichtbaar BOM-teken, waardoor zijn eerste export niet gezien
werd en drie bestanden onterecht werden afgekeurd.

Deze controle heeft zich daarna live bewezen door een kapot bestand tegen te
houden vóór de commit — zie hieronder.

**Deel 4 — lees- en zoekgereedschap** (`builder-tools.ts`,
`chatCompletionWithTools` op `LlmProvider`). Twee gereedschappen:
`zoek_bestanden` en `lees_bestand`. Bewust niets meer:

- **Geen schrijfgereedschap.** Schrijven blijft via het vaste pad, mét de
  bewerkingsblokken (deel 2) en de importcontrole (deel 3) eromheen. Anders kan
  het model langs precies de controles heen schrijven die daarvoor bestaan.
- **Geen uitvoergereedschap.** Zie de correctie bij deel 4 hierboven: dat kan op
  Vercel niet, en het hoeft niet — de CI doet het.
- **Bovenop de gedwongen bewijslaag, nooit ervoor in de plaats.**

De gereedschapslus zit in de provider en niet in de rol, omdat Anthropic en
OpenAI om compleet andere berichtvormen vragen. Zou de aanroeper die lus
draaien, dan moest elke rol die gereedschap wil dat werk overdoen.

**Ook voor QA (15 september).** Een uur na oplevering kon QA een criterium niet
vaststellen met als reden: "de inhoud van ci-wait.ts ontbreekt". Exact hetzelfde
gat, bij een andere rol. QA heeft nu hetzelfde gereedschap. De modulenaam
`builder-tools.ts` is daarmee te eng geworden en is een kandidaat om te
hernoemen.

### De les van deze twee dagen: laat de oude weg altijd open

Drie keer op rij is dezelfde fout gemaakt, en die is het opschrijven waard omdat
hij zich niet als fout aankondigt.

1. **Deel 2 (patch-modus).** Lukte de gerichte bewerking na twee pogingen niet,
   dan stierf de toewijzing. Bewuste keuze destijds, met een redenering die
   klopte voor "nog een poging met dezelfde methode" — maar die werd toegepast
   op "overstappen op een andere methode", en dat is iets anders. Een missie
   viel stil terwijl gewoon het hele bestand herschrijven (3 kB) prima had
   gewerkt.
2. **Deel 4 (gereedschap).** Dezelfde constructie: mislukte de
   gereedschapsaanroep, dan viel de toewijzing om. Dat gebeurde meteen bij de
   eerste live poging, en niet eens door iets van ons — zie hieronder.
3. **De terugval van deel 2 zelf.** Die schreef bij gebrek aan een vormcontrole
   de weigering van het model als bestandsinhoud weg. Alleen deel 3 ving dat af.

De regel die hieruit volgt: **een optimalisatie die het onderliggende pad kan
blokkeren is geen optimalisatie maar een storing.** Elk nieuw mechanisme krijgt
een terugval op het pad dat het vervangt, en die terugval logt luid genoeg om te
merken dát hij gebruikt wordt.

### OpenAI-gereedschap loopt over de Responses API — 15 september 2026

De eerste live poging met gereedschap gaf meteen een 400:

> "Function tools with reasoning_effort are not supported for gpt-6-astra in
> /v1/chat/completions. To use function tools, use /v1/responses or set
> reasoning_effort to 'none'."

Geen fout van deze codebase. Redenerende modellen van OpenAI accepteren geen
gereedschap op de chat-API, ook niet wanneer wij `reasoning_effort` helemaal niet
meesturen — die modellen redeneren standaard, en dan geldt de beperking
onzichtbaar. De uitweg die de melding zelf noemt bestaat voor dit model
bovendien niet: gpt-6-astra accepteert de waarde `none` niet.

Daarom loopt `chatCompletionWithTools` bij OpenAI over `/v1/responses`. De
gewone `chatCompletion` blijft op `/v1/chat/completions` — die werkt daar prima,
en elke rol zonder gereedschap merkt er niets van.

Eén detail dat essentieel is en makkelijk te missen: het volledige antwoord van
het model, **inclusief zijn redeneerstappen**, moet ongewijzigd terug in `input`.
Gooi je die weg tussen twee gereedschapsrondes, dan verliest het model zijn eigen
gedachtegang en begint het elke ronde opnieuw.

### Waar de bewijslaag écht tekortschoot — 14 september 2026

Vier pogingen op rij strandden op "het antwoord bevat geen enkel bewerkingsblok".
Twee keer is er op de vórm van die fout gegokt (soepelere markeringherkenning,
een terugval) voordat het ruwe modelantwoord uit de Vercel-logs werd opgehaald.
Daar stond het echte antwoord:

> "De daadwerkelijke definitie van MissionAdvanceOutcome ontbreekt. Zonder
> repositorytoegang kan ik die niet raadplegen. Zonder die informatie zou een
> bewerkingsblok velden moeten veronderstellen, in strijd met je expliciete
> opdracht om niets te verzinnen."

Het model faalde niet, het **weigerde** — en precies om de reden die wij het zelf
hebben opgedragen. Drie dingen kwamen daaruit voort:

- **`objective-evidence.ts`**: bestanden die de opdracht met naam noemt gaan
  automatisch mee. Alleen paden die aantoonbaar in de branch staan; een verzonnen
  pad wordt nooit opgehaald.
- **Een kanaal voor "ik mis iets"**: het model mag antwoorden met
  `ONVOLDOENDE CONTEXT: <wat>`. `INSUFFICIENT_CONTEXT` bestond al, maar alleen de
  contextresolver kon het opwerpen — vooraf, structureel. Het model zat op de
  enige plek waar de échte behoefte zichtbaar wordt en had daar geen stem.
- **Een vormcontrole** (`looksLikeSourceCode`): een antwoord waarin geen enkele
  regel met een gangbaar sleutelwoord begint, wordt niet als `.ts`-bestand
  weggeschreven.

**De bredere les:** twee keer gokken op de vorm van een fout kostte een avond,
terwijl het letterlijke antwoord al in de logs stond. Bij een herhaalde fout
eerst het ruwe antwoord ophalen, dan pas een hypothese.

### De autonome tik is onbetrouwbaar, dus wacht de missie zelf — 15 september 2026

De pauze na een builder-stap (zie hierboven) rekende erop dat de volgende tik
tien minuten later komt. Dat klopt niet. GitHub noemt zijn schedule-trigger
uitdrukkelijk "best effort" en geeft zelf aan dat geplande runs bij drukte
vertraagd of **helemaal weggegooid** worden, zonder enig spoor in de logs. De
drukste momenten zijn de ronde tijdstippen — en `*/10` valt daar precies op. In
de eerste dag stonden er elf runs waar er honderden hadden moeten staan, soms
vier uur uit elkaar.

Er bestaat dus geen "de tik betrouwbaar maken" zolang GitHub de klok is. Daarom
is het probleem omgedraaid: de missie wacht de CI nu áf binnen dezelfde aanroep
(`ci-wait.ts`, maximaal drie minuten, met zestig seconden marge vóór de
Vercel-deadline). Lukt dat, dan loopt een missie in één tik door van bouwen naar
QA naar mergen. Lukt het niet, dan geldt gewoon het oude gedrag.

Eén ding is bewust niet versoepeld: "geen check-runs gevonden" telt níet als
klaar. Dat is precies de toestand vlak na een push waar de hele pauze voor
bestaat, en er staat een test op.

De cron staat nu op losse, oneven minuten. Geen garantie, wel gratis. Blijkt dit
alsnog te traag, dan is de volgende stap een externe planner die de workflow via
`workflow_dispatch` start — bewust nog niet gedaan, want dat betekent
`MISSION_ADVANCE_SECRET` in een dienst van derden.

### Eerste missie die zichzelf moest informeren — 15 september 2026

De proef op de som voor deel 4: een opdracht die het type `CiWaitOutcome` liet
gebruiken zónder te zeggen waar het stond. De vier waarden van dat type komen
nergens voor in wat de Builder normaal te zien krijgt.

Resultaat (PR #63): correcte import uit `src/core/mission-engine/v2/ci-wait.ts`,
en precies de vier waarden `SETTLED`, `TIMED_OUT`, `NO_PULL_REQUEST` en `ERROR`
— niet meer en niet minder. Hij heeft het bestand zelf gezocht en gelezen.

In dezelfde run werkte ook het CI-wachten binnen de tik (130 seconden), en
weigerde QA terecht een oordeel omdat de branch achterliep op `main`. Na het
bijwerken van de branch, één ownervraag en een merge stond de missie op VOLTOOID.

### Stap 19 — In-app CI/PR-zichtbaarheid

Voltooid en live bevestigd op 17 september 2026.

(voorheen stap 17, oorspronkelijk stap 10) De stand van de pull request en
de CI staat nu in het paneel "Director & uitvoering" zelf: nummer met link,
open/gemerged/gesloten, de CI-uitslag mét de namen van de checks, hoeveel
commits de branch achterloopt op de standaardbranch, en de gewijzigde
bestanden. Plus de ouderdom van het beeld, zodat zichtbaar is dat je naar
iets van vijf minuten geleden kijkt.

Drie keuzes die erin zitten en waarom: het laadt apart van de missie (vier
GitHub-aanroepen zijn te duur om aan elke missie-ophaal te hangen), het
ververst niet vanzelf (een CI-controle duurt minuten; pollen zou een vaste
stroom aanroepen opleveren voor informatie waar meestal niemand naar kijkt),
en het gaat nooit vóór de missie staan — mislukt het ophalen, dan staat er
één regel en verder niets.

Aanleiding: op 15 september kostte het een avond om te achterhalen waaróm
een missie vastliep. De enige weg was naar GitHub Actions, de juiste run
aanklikken, de job openklappen en JSON onderaan een curl-logboek lezen. Twee
keer was de reden iets wat nu in één regel op het scherm staat.

**Les uit de oplevering.** De eerste versie gebruikte de kleurvariabelen
`--success`, `--danger` en `--warning`. Die bestaan niet in dit thema, dus
viel alles terug op de standaardwaarden voor een licht thema: het
PR-nummer werd donkerblauw op donkergroen en was letterlijk onleesbaar. CSS
waarschuwt hier niet voor — een niet-bestaande variabele is geen fout maar
een terugval. Bij het toevoegen van stijlen hoort dus een blik in
`globals.css` op wat er werkelijk gedefinieerd is; dezelfde fout stond al op
vijf oudere plekken in `mission-panels.css` en is daar meteen meegenomen.

### Stap 25 — Echte documentverwerking voor de Knowledge Foundation
Volgt uit de externe code-audit van 13 september 2026 (zie
`docs/reviews/code-audit-13-september-2026.md` voor het volledige oordeel per
bevinding). De Knowledge-pagina accepteerde PDF, DOCX, XLSX en afbeeldingen,
maar alleen Markdown werd inhoudelijk gelezen; van de rest werd uitsluitend
metadata vastgelegd. `package.json` bevatte geen enkele parserbibliotheek.

Dit was geen defect maar ontbrekende capaciteit — er ging niets kapot, er was
iets niet gebouwd.

**Voltooid en live bevestigd op 17 september 2026.**

De browser leest het bestand nu zelf uit (`src/domains/documents/parsing/`):
DOCX en XLSX met een eigen ontleding bovenop `fflate`, PDF met pdf.js. Alleen
de gewonnen tekst gaat naar de server, en die gaat langs dezelfde
kennisextractie als een Markdown-bestand. De extensiecontrole in
`/api/knowledge/import` is daarmee verplaatst van "is dit Markdown" naar "is
dit een soort waarvan wij de inhoud werkelijk kunnen lezen" — punt (3) van de
audit.

#### Afwijking van de volgorde uit de audit, en waarom

De audit schreef deze volgorde voor: (1) echte binaire upload met server-side
hash, MIME-detectie op de werkelijke bytes en immutable bronversies; (2)
parser-adapters per formaat; (3) kennisextractie op een geparseerde bron; (4)
structurele chunking met provenance.

Punt (1) is naar achteren geschoven, bewust en met instemming van Elroy. Twee
redenen, allebei hard:

- Vercel accepteert ongeveer 4,5 MB per aanvraag. Een PDF van 10 MB komt
  sowieso niet door een serverfunctie heen, dus "de bytes naar de server"
  vraagt hoe dan ook een aparte opslagdienst — het is geen kleinere stap dan
  (2), maar een grotere.
- De originele bytes bewaren vraagt Firebase Storage, en dat zit sinds eind
  2024 niet meer in het gratis Firebase-pakket.

Daarmee stond de goedkoopste route naar de capaciteit die werkelijk ontbrak
(documenten die gelezen worden) achter de duurste stap in de lijst. De prijs
van deze volgorde is eerlijk te benoemen: het originele bestand wordt niet
bewaard, dus een document kan later niet opnieuw door een betere parser
gehaald worden. Wie dat wil, uploadt het bestand opnieuw.

Wat daarmee blijft staan als eigen stap: zie stap 26, onder
"Voorgestelde volgende stappen".

#### Wat wel en niet gelezen wordt

- **DOCX** — alinea's, koppen (worden Markdown-koppen), tabellen, harde
  regeleindes. Niet: kop- en voetteksten, voetnoten, opmerkingen, en tekst die
  in bijgehouden wijzigingen als verwijderd staat.
- **XLSX** — alle werkbladen als tab-gescheiden tekst, met de bladnaam erboven
  en lege cellen op hun plaats. Datums komen eruit als het getal dat Excel
  opslaat; de opmaakketen navolgen is een parser op zich, en er net naast
  zitten zou erger zijn dan een zichtbaar getal.
- **PDF** — de tekstlaag. Een ingescande PDF zonder tekstlaag levert niets op
  en eindigt als "alleen vastgelegd"; daar hoort tekstherkenning bij en die is
  er niet.
- **Afbeeldingen** — onveranderd alleen vastgelegd.

De harde regel uit de audit blijft staan en is nu andersom bekrachtigd: een
bestand geldt pas als gelezen wanneer er werkelijk tekst uit is gekomen. De
telling in de meldingsregel kijkt niet meer naar de extensie maar naar het
resultaat, dus een beschadigd bestand en een ingescande PDF eindigen op
dezelfde plek als een afbeelding.

#### Terugval

Elke parser valt terug op het gedrag van vóór deze stap: mislukt het lezen,
dan wordt het bestand alleen vastgelegd, met de reden in de console van de
browser. Dat is de les uit 15 september 2026 toegepast — een nieuw mechanisme
dat het onderliggende pad kan blokkeren is een gebrek, geen verbetering. Ook
het hulpscript `scripts/copy-pdf-worker.mjs` stopt nooit met een foutcode: een
ontbrekende pdf.js-werker kost de PDF-tak, niet de bouw.

#### Les: schrijf tegen de versie die er werkelijk staat

`npm install pdfjs-dist` leverde versie 6, nieuwer dan waar de code voor
geschreven was. Twee dingen braken, allebei alleen zichtbaar via `npm run
typecheck`: de optie `isEvalSupported` bestaat niet meer, en `destroy()` zit
niet langer op het document maar op de laadtaak. Het tweede was een echte
slordigheid — in de typedefinities was op `destroy()` gezocht en een treffer
gevonden, zonder na te gaan bij wélke klasse die hoorde.

Wat dat kost: twee extra rondes van "plak dit, stuur me de uitvoer". Wat het
had voorkomen: na de installatie eerst de geïnstalleerde typedefinities
openslaan en de gebruikte aanroepen erin terugzoeken, klasse voor klasse, in
plaats van vertrouwen op wat de bibliotheek in een eerdere versie deed. Bij
een bibliotheek die zijn API per grote versie herschikt is dat geen
overdreven voorzichtigheid maar de normale werkwijze.

Bewust NIET meegenomen uit die audit: de voorgestelde migratie van het hele
kennismodel naar Claims/Evidence/Entities/Relationships. De onderbouwing staat
in hoofdstuk 4 van het oordeelsdocument; kort: die "reeds ontworpen
V2-architectuur" is een schets van ruim één pagina met `Status: Review
required`, en de concrete schade die ermee werd verdedigd (een verdwijnende
tweede bron) is op 13 september al gerepareerd zonder re-architectuur.

#### Wat de livetest liet zien

Drie proefbestanden tegelijk geüpload — een DOCX met koppen en een tabel,
een XLSX met drie werkbladen waarvan één leeg, en een PDF. Uitkomst: "3
bestanden geregistreerd, waarvan 3 inhoudelijk gelezen", zeven kennisitems
ter beoordeling.

Het belangrijkste in die zeven zat niet in de inhoud maar in het
`section`-veld: "Agents werken via GitHub", "Kosten blokkeren nooit een
missie", "Voltooid betekent gemerged" — de koppen uit het Word-document —
en "Grenzen" en "Wat de prijs is" uit respectievelijk de bladnaam van het
werkblad en een kop in de PDF. Dat veld was zonder deze stap gokwerk bij
alles wat geen Markdown was. Het meeleveren van koppen en bladnamen is
daarmee geen opsmuk: het is wat een kennisitem terugvindbaar maakt.

Wat de extractie terecht liet liggen: de kostenregels per pull request uit
het eerste werkblad. Die zijn geen duurzame kennis, en ze kwamen dan ook
niet terug als kennisitem — terwijl de tekst er wel degelijk was.

## Restpunten

Kleine dingen die bij een grotere stap zijn gesignaleerd en bewust zijn
blijven liggen. Elk punt staat hier als eigen kopje, zodat de Director ze
meekrijgt in zijn projectstand-index (die leest alleen `###`-kopjes) — een
restpunt dat alleen in een alinea staat, bestaat voor hem niet. Verdwijnt een
punt, haal het kopje dan weg in plaats van er "opgelost" achter te zetten —
anders groeit dit hoofdstuk alsnog dicht.

Momenteel geen openstaande restpunten (laatste zeven afgerond op
7 september 2026 — zie de Tussentijds-secties hierboven).

## Voorgestelde volgende stappen

Stap 12 t/m 14 (oorspronkelijk 9 t/m 14; 9, 10 en 11 staan inmiddels hierboven
onder Voltooid) zijn door Claude bedacht als logisch vervolg op de voltooide
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

### Herziening: prioriteit naar onbewaakt doorbouwen (12 september 2026)

Aanleiding: bij het navragen hoe lang het nog duurt voordat er iets werkt,
werd duidelijk dat stap 14 t/m 23 hierboven stuk voor stuk over de
bouwmachine zelf gaan (betrouwbaarheid, overzicht, uitbreidbaarheid) en geen
van alle over de vier kernen waarvoor Elroy The Dost Matrix bouwt (apps en
games, muziek, daytraden, zelfstandige uitvoering) — en dat geen van die
stappen ooit tot "'s avonds missies klaarzetten, 's ochtends resultaat zien"
zou leiden, ook niet als ze allemaal af waren.

Drie concrete blokkades bleken in de weg te staan, onafhankelijk van hoe
goed een individuele stap gebouwd is:

1. **Geen hosting.** The Dost Matrix draait uitsluitend via `npm run dev` op
   Elroy's eigen laptop; zodra die dichtgaat, bestaat de Matrix even niet
   meer. Onbewaakt doorbouwen is dus sowieso onmogelijk, ongeacht welke
   andere stap er staat.
2. **Geen autonome missie-triggers.** Stap 21 (hieronder verplaatst naar
   stap 15) bestond al als voorstel, maar ging ervan uit dat elke volgende
   missie nog steeds door Elroy zelf gestart wordt.
3. **Elke needs-signoff-missie wachtte op Elroy's eigen goedkeuringsklik.**
   Bij architectuurwijzigingen (vrijwel alles in stap 14-23 hierboven) is dat
   de norm, niet de uitzondering — dus zonder wijziging zou zo goed als elke
   nachtelijke missie stilstaan tot de ochtend, zelfs mét de eerste twee
   punten opgelost.

Elroy heeft naar aanleiding hiervan expliciet besloten: de needs-signoff-
beoordeling wordt overgedragen aan de Director/Claude zelf, in plaats van
bij hem te blijven liggen — hij wil niet zelf per wijziging hoeven
beoordelen of iets veilig is. Dat vervangt puntje 3 hierboven, zonder de
bestaande harde invarianten los te laten: COMPLETED blijft alleen mogelijk
als de pull request echt gemerged is, CI moet groen zijn, en alle criteria
moeten PASSED zijn (zie Stap 3, 4 en 7 hierboven) — de menselijke klik
verdwijnt, de vangnetten niet.

Eén uitzondering blijft bewust bestaan, als eigen technische keuze bij deze
overdracht: wijzigingen in een herkenbaar gevaarlijke categorie (secrets/
tokens, `.github/workflows/`, authenticatie, of het verwijderen van
bestanden) worden nooit automatisch gemergd, ongeacht CI-status — die
escaleren naar Elroy via hetzelfde WAITING_FOR_OWNER-patroon dat stap 12b al
gebruikt voor oprechte twijfel, in plaats van een nieuw mechanisme. Voor
alles daarbuiten beslist de Director zelfstandig, op basis van dezelfde
bewijslaag die vandaag al bestaat (CI-uitkomst, QA-criteria, PR-diff) — geen
extra LLM-oordeel er los bovenop geplakt.

Consequentie die hier eerlijk bij hoort: voor de meeste wijzigingen valt de
menselijke blik vóór merge nu grotendeels weg. Dat maakt de kwaliteit van
CI/testdekking belangrijker dan hij tot nu toe was — geen reden om dit niet
te doen, wel een reden om testdekking niet verder te laten verslappen.

Nieuwe volgorde: stap 14 en 15 hieronder gaan vóór alles wat al stond
(oorspronkelijke stap 14 t/m 20, 22 en 23 schuiven door naar stap 16 t/m 25;
oorspronkelijke stap 21 is hierin opgegaan als herziene stap 15).

(Stap 15 stond hier. Voltooid en live bewezen op 13 september 2026 —
verplaatst naar "Voltooid" hierboven.)

### Stap 16 — Council V1.5: Claim Ledger, validatie en uitbreiding
(voorheen stap 14) Pas nadat stap 13 zich bewezen heeft: het Claim Ledger
waarin elke technische claim bewijsverwijzingen, steun/tegenspraak en een
status (SUPPORTED / DISPUTED / UNKNOWN / REFUTED) krijgt, met
runtime-validatie dat een bewijsverwijzing daadwerkelijk bestaat — een
verzonnen verwijzing wordt geweigerd in plaats van geloofd.
Bewijsverwijzingen zijn gepind aan de commit-SHA van het bewijspakket; na
een herstelpoging vervalt eerder bewijs.

Daarna pas: extra providers via een Model Registry (de OpenAI-compatibele
aanbieders vragen alleen configuratie, Google vraagt een eigen adapter),
en automatische triggers bij herhaald falen, hoog risico of tegenstrijdige
QA.

(Stap 17 stond hier. Voltooid en live bewezen op 13 september 2026 —
verplaatst naar "Voltooid" hierboven. Het eerste deel van stap 18 is
in dezelfde missie meegetest en staat daar ook.)

(Stap 18 stond hier, met deel 3 en deel 4 nog open. Allebei voltooid en live
bevestigd op 14 en 15 september 2026 — zie "Stap 18 volledig af" hieronder.)


(Stap 19 stond hier. Voltooid en live bevestigd op 17 september 2026 —
verplaatst naar "Voltooid" hierboven.)

### Stap 20 — Doorzoekbare Second Brain-UI
(voorheen stap 18, oorspronkelijk stap 11) Een eenvoudig zoek-/filterscherm
(op onderwerp, missie, datum) binnen Command Center, zodat kennis
terugvindbaar is zonder dat Elroy weet welke missie 'm oorspronkelijk
voorstelde.

### Stap 21 — Missie-sjablonen
(voorheen stap 19, oorspronkelijk stap 12) Voor terugkerende soorten missies
een herbruikbaar sjabloon met vooraf ingevulde objective/succescriteria.

### Stap 22 — Claude zichtbaar ingebed in de app
(voorheen stap 20, oorspronkelijk stap 13) Een paneel in Command Center dat
live meekijkt met een externe Claude Code/Cowork-sessie (logs/activiteit).
Nog geen twee-richtingen besturing — puur zichtbaarheid als eerste stap.

### Stap 23 — Visualisatie van wat er achter de schermen gebeurt
(voorheen stap 22, oorspronkelijk stap 15, door Elroy zelf toegevoegd) Een
visuele weergave van de live activiteit binnen The Dost Matrix (missies,
rollen, Second Brain-updates, verificatiestatus, raadssessies) zodat Elroy
in één oogopslag ziet wat het systeem doet. De precieze vorm wordt later
samen ontworpen — dit is bewust nog niet ingevuld.

(Stap 24 stond hier. Voltooid en live bevestigd op 13 september 2026 —
verplaatst naar "Voltooid" hierboven.)

(Stap 25 stond hier. Voltooid en live bevestigd op 17 september 2026 —
verplaatst naar "Voltooid" hierboven.)

### Stap 26 — De originele bestanden bewaren
Het losgeknipte punt (1) uit de audit, hierboven toegelicht. Zodra Firebase
Storage aanstaat (Blaze-abonnement): het bestand rechtstreeks vanuit de browser
naar Storage, server-side hash en MIME-detectie op de werkelijke bytes, en een
onveranderlijke bronversie per upload. Pas daarná krijgen parserversies in
provenance betekenis, want pas dan valt een document opnieuw te verwerken.

Voorwaarde vooraf, en de reden dat dit een eigen stap is en geen bijzin: dit
kost geld per maand. Het hoort niet ongemerkt aan te gaan omdat een technische
stap er toevallig om vroeg.


## Acceptatiecriteria voor stap 9 t/m 12

Overgenomen uit de tweede beoordeling: het probleem geldt pas als opgelost
wanneer deze regressiemissies slagen, niet wanneer één missie toevallig goed
gaat.

- **A** — Tests toevoegen aan een bestaande functie met twee argumenten,
  terwijl wijzigen van productiecode verboden is. De Builder moet de echte
  signatuur lezen en groene tests opleveren zonder tussenkomst. (stap 10) —
  GESLAAGD, en wel door dezelfde run als stap 10 hierboven: PR #40 testte
  `canTransitionMission(from, to)` — twee argumenten, test-only, en de
  functienamen stonden bewust niet in de opdracht. Achteraf hier vastgelegd
  op 7 september 2026; het stond er alleen nooit als criterium A bij, waardoor
  de Director het bleef melden als openstaand. Een document dat achterloopt
  liegt in twee richtingen.
- **B** — Een functie testen waarvan het gedrag afhangt van geïmporteerde
  helpers met gemockte returnvormen. Geen verzonnen vormen. (stap 10) —
  GESLAAGD, live gedraaid op 7 september 2026 met de missie "Tests voor de
  Knowledge Review Agent" (PR #54, gemerged). De Builder moest `reviewer.ts`
  testen, dat zijn LLM-provider via `getChatProvider()` ophaalt. Hij mockte
  die met exact de aanroepvorm uit de bron — `chatCompletion(systemPrompt,
  messages)` — en liet hem teruggeven wat de bron werkelijk uitleest:
  `{ content, model }`. Alle vier de foutmeldingen die hij assert staan
  letterlijk zo in `reviewer.ts`. Acht tests in plaats van de zes gevraagde;
  de twee extra dekken dat `edit` óók faalt als alleen de titel ontbreekt, en
  dat spaties rond een tekstvoorstel worden weggehaald — details die je alleen
  ziet als je de bron echt gelezen hebt. Alle acht succescriteria op GEHAALD,
  CI groen, kosten $0,27.

  QA deed hier precies waar stap 12 voor bedoeld was. Het criterium "geen
  verzonnen en geen ontbrekende velden" was door mij slordig geformuleerd (de
  mock geeft `{ chatCompletion }` terug terwijl `LlmProvider` ook een `id`
  heeft). QA redeneerde daar expliciet over en oordeelde dat het criterium
  gaat over de teruggegeven wáárde, die exact klopt — een geredeneerd oordeel
  tegen de echte broncode, geen afvinkerij. Dat oordeel houdt stand.
- **C** — Een module die via een barrel-export of path-alias wordt
  geïmporteerd. (pas verwacht bij stap 16)
- **D** — Opzettelijk een compileerfout in poging 1. De CI-fout moet
  automatisch worden hersteld binnen het pogingplafond. (stap 11) — GESLAAGD,
  live gedraaid op 6 september 2026 met een met de hand geplaatste typefout op
  de missiebranch van PR #43; hersteld in poging 1 van 3, zonder tussenkomst.
  Zie stap 11 hierboven, inclusief de drie gebreken die dezelfde test
  blootlegde en die nu stap 12 sturen.
- **E** — Een missie met twee opeenvolgende Builder-toewijzingen. De tweede
  moet het werk van de eerste zien. (stap 9) — GESLAAGD, live gedraaid op
  5 september 2026, zie stap 9 hierboven.
- **F** — QA een test-only diff voorleggen met een bewust verkeerde
  mock-signatuur. QA moet die afkeuren op inhoud, niet pas via de CI.
  (stap 12) — NOG NIET GEDRAAID. De opzet is wel uitgezocht op 7 september
  2026, zodat een volgende sessie dat niet opnieuw hoeft te doen:

  - **QA kan niet twee keer oordelen.** Staan alle succescriteria op PASSED
    en loopt er geen toewijzing, dan zet `runDirectorStep` een nieuwe
    qa-toewijzing dwingend om in COMPLETE_MISSION en gaat de missie mergen.
    De fout injecteren ná QA's goedkeuring kan dus niet.
  - **Het venster zit tussen de Builder en QA.** Eén klik op "Laat de
    Director de volgende stap zetten" is precies één beslissing plus één
    rol-uitvoering; daarna staat de missie stil. Na de klik die de Builder
    draait kan de aangepaste testversie naar de missiebranch worden gepusht,
    en pakt QA bij de volgende klik die versie op (hij haalt de bestanden op
    bij de actuele `headSha` van de pull request). Dezelfde werkwijze als bij
    regressietest D.
  - **De fout moet CI-onzichtbaar zijn.** Een verkeerde mock die de typecheck
    of de tests rood maakt toetst niets: dan vángt de CI het, en juist dát is
    wat F wil uitsluiten. De fout moet dus een verzonnen vorm zijn waar de
    test zelf consistent mee is.
  - **Let op de opdrachttekst.** Wordt de Builder gestuurd om het fout te
    doen, dan ziet QA dat de fout gevraagd was en is het oordeel besmet. De
    injectie moet dus buiten de opdracht om.
