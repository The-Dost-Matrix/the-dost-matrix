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
een latere opruimronde. QA's tweede suggestie — de hardgecodeerde
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

### Stap 12b — QA mag twijfelen, en de eigenaar krijgt de vraag
Twee keer op één dag liep een missie vast op een criterium dat aantoonbaar
gehaald was, zonder dat er een uitweg bestond. De oorzaak is niet dat de
rollen te dom zijn, maar dat ze geen manier hebben om te zeggen wat er aan de
hand is.

**QA kan maar twee dingen zeggen.** Gehaald of niet gehaald. Twijfel — "ik kan
dit niet vaststellen uit wat ik gekregen heb" — komt er daarom uit als een
afkeuring. QA krijgt een derde antwoord: NIET VAST TE STELLEN, met de reden,
los van afgekeurd.

**En de uitweg loopt dood.** De Director kán besluiten de eigenaar een vraag
te stellen (`REQUEST_OWNER_INPUT`), de status `WAITING_FOR_OWNER` bestaat, en
`engine.recordOwnerInput()` is volledig geïmplementeerd inclusief
gebeurtenis. Maar de API-route kent de actie niet en de UI heeft geen knop: een
missie die daar belandt kan alleen nog geannuleerd worden. De vraag kán dus
gesteld worden, het antwoord kan nooit gegeven worden. Daarom is het nog nooit
gebeurd.

Te bouwen: zegt QA "niet vast te stellen", of is het plafond uit stap 12
bereikt, dan stelt de Director de vraag aan de eigenaar in plaats van te
stoppen — met het criterium, de twijfel van QA en het tegenargument van de
Builder erbij. De app toont die vraag en laat de eigenaar antwoorden (gehaald
of niet gehaald, met een reden die op het criterium bewaard blijft), waarna de
missie doorloopt.

Dit is bewust geen losse "overrule QA"-knop: het is het afmaken van een lus
die er half in zat. De eigenaar is de opdrachtgever, QA is een adviseur.

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
  (stap 12)
