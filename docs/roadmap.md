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
gevonden ontbrekende testdekking voor `mission-knowledge.ts` wordt
opgevolgd als losse, laag-risico missie.)

### Stap 9 — Multi-LLM-selector
Verbind de Anthropic Claude API naast de bestaande OpenAI/ChatGPT-koppeling,
en bouw een eenvoudige, uitlegbare selector die per taaktype het meest
geschikte model kiest (bijv. op basis van rol — Director/Builder/QA — en
taakcomplexiteit), met ruimte om later gratis LLM's via API toe te voegen.

### Stap 10 — In-app CI/PR-zichtbaarheid
Toon PR-status (open/gemerged, CI groen/rood, welke checks) direct in de
missie-kaart in The Dost Matrix, zodat Elroy nooit naar GitHub.com hoeft om
te zien waar een missie op vastloopt.

### Stap 11 — Doorzoekbare Second Brain-UI
Second Brain is nu een lijst met goedgekeurde items. Voeg een eenvoudig
zoek-/filterscherm toe (op onderwerp, missie, datum) binnen Command Center,
zodat kennis ook terugvindbaar is zonder dat Elroy weet welke missie 'm
oorspronkelijk voorstelde.

### Stap 12 — Missie-sjablonen
Voor terugkerende soorten missies (bijv. "voeg unit tests toe aan X",
"onderzoek library Y") een herbruikbaar sjabloon met vooraf ingevulde
objective/succescriteria, zodat Elroy niet telkens from scratch een missie
hoeft te formuleren.

### Stap 13 — Claude zichtbaar ingebed in de app
Eerste concrete stap richting "Claude embedded in The Dost Matrix": een
paneel in Command Center dat live meekijkt met een externe Claude Code/
Cowork-sessie (logs/activiteit), zodat Elroy niet meer hoeft te schakelen
tussen scherm en sessie om te volgen wat er gebeurt. Nog geen twee-richtingen
besturing — puur zichtbaarheid als eerste stap.

### Stap 14 — Autonome missie-triggers
De Director mag zelf, op basis van een eenvoudige, vooraf goedgekeurde regel
(bijv. "elke maandag: controleer op verouderde dependencies"), een missie
voorstellen of starten zonder dat Elroy eerst zelf op "nieuwe missie" klikt —
met dezelfde risico-classificatie en approve-and-merge-veiligheidsnetten als
elke andere missie. Dit is de eerste concrete stap richting het
oorspronkelijke Jarvis-achtige eindbeeld ("praat of typ, het systeem gaat
zelf aan het werk").

### Stap 15 — Visualisatie van wat er achter de schermen gebeurt
Een visuele weergave van de live activiteit binnen The Dost Matrix (missies,
rollen, Second Brain-updates, etc.) zodat Elroy in één oogopslag ziet wat het
systeem op dit moment doet, in plaats van losse statuswaarden per scherm bij
elkaar te moeten zoeken. De precieze vorm (bijv. een live diagram, een
tijdlijn, een "systeemkaart") wordt later samen ontworpen zodra deze stap aan
de beurt is — dit is bewust nog niet ingevuld.
