# Mission Engine

## Missie-inhoud

Titel, doel, achtergrond, acceptatiecriteria, randvoorwaarden, prioriteit, risico, deadline en benodigde goedkeuringen.

## Levenscyclus

```text
draft → planned → awaiting_approval | active
active → paused | blocked | completed | failed | cancelled
paused | blocked → active | cancelled
```

## Versies

Elke inhoudelijke wijziging maakt een nieuwe MissionVersion. Oude versies blijven raadpleegbaar. Lopende taken worden opnieuw beoordeeld wanneer een wijziging hun geldigheid beïnvloedt.

## Planning

De Director levert taken, afhankelijkheden, rollen, kwaliteitsgates, risico's, goedkeuringspunten en verwachte artefacten.

## Activatievoorwaarden

Verplichte velden zijn aanwezig, afhankelijkheden zijn geldig, noodzakelijke goedkeuringen bestaan en het plan is uitvoerbaar.

## Herplanning

Wordt gestart bij gewijzigde missie, taakfalen, blokkade, nieuw risico, onvoldoende kwaliteit of ontbrekende middelen.

## Herstel

Per taak zijn maximaal twee automatische, aantoonbaar verschillende herstelpogingen toegestaan.

## Voltooiing

Alle vereiste taken zijn afgerond, acceptatiecriteria zijn aangetoond, QA heeft goedgekeurd, artefacten zijn geregistreerd en relevante kennis is vastgelegd.

Cyclische afhankelijkheden worden geweigerd.
