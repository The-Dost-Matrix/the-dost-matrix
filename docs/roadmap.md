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
handmatig chat-gebruik.

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

## Voorgestelde volgende stappen

Stap 6 t/m 14 zijn door Claude bedacht als logisch vervolg op de voltooide
stappen, gebaseerd op wat Elroy al eerder heeft aangegeven te willen
(multi-LLM, Claude ingebed in de app zelf, een écht autonome Director) en op
concrete technische kanttekeningen die tijdens het bouwen van stap 1 t/m 5
al zijn gesignaleerd maar nog niet zijn opgelost. Dit is een voorstel, geen
vaststaand plan — pas aan, herschik of schrap wat niet (meer) relevant is.
Stap 15 is door Elroy zelf toegevoegd; de invulling ervan volgt later.

### Stap 6 — GitHub App i.p.v. fine-grained token
`GITHUB_BUILDER_TOKEN` is bewust repo-gescoped, maar mist daardoor toegang
tot de Checks-API (bevestigde GitHub-limitatie voor dit tokentype). Een
GitHub App (repo-gescoped, mét Checks-toegang) lost dit definitief op —
eenmalig meer opzetwerk, geen nieuwe architectuurdiscussie.

### Stap 7 — Echte CI-statuscontrole vóór automerge
Nu bouwt op stap 6: de Director controleert vóór auto-merge de daadwerkelijke
CI-status via de Checks-API, in plaats van "geen bekende reden om te
blokkeren" aan te nemen. Voorkomt dat een missie ooit een PR met falende CI
automatisch merget.

### Stap 8 — Second Brain-schrijfhaak vanuit de missie-loop zelf
Op dit moment is de chat ("Mogelijk kennisitem") de enige automatische weg
naar Second Brain — de Director/Builder/QA-loop van Mission Engine V2 zelf
heeft nog geen schrijfhaak. Voeg een vergelijkbaar voorstel-mechanisme toe
direct vanuit een afgeronde missie (bijv. een technische les die de Builder
tegenkwam), zodat kennis niet afhankelijk is van of Elroy toevallig iets in
de chat typt.

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
