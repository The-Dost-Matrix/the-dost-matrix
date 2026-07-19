# Orchestratiemodel

De Director maakt het semantische plan. De scheduler bepaalt uitvoeringsvolgorde op basis van afhankelijkheden, prioriteit, capaciteit, kosten, risico, deadlines en mandaten.

Een taak is uitvoerbaar wanneer status `ready` is, afhankelijkheden voltooid zijn, invoer beschikbaar is, een passende rol-instantie beschikbaar is en toestemming geldig is.

Parallelle uitvoering is toegestaan zonder conflicterende resources. Kritieke resources gebruiken leases of locks met vervaltijd.

Retries zijn alleen toegestaan voor herstelbare fouten. Semantische kwaliteitsfouten worden niet blind herhaald. Bij herhaalde providerfouten treedt een circuit breaker in werking.

Herplanning bewaart de oude planning en gebruikt gestructureerde foutinformatie. Uitvoering stopt bij intrekking door de Eigenaar, ongeldig mandaat, kritieke beveiligingsmelding, overschreden herstelgrens, onoplosbare afhankelijkheid of behaald acceptatieresultaat.
