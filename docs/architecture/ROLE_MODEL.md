# Rollenmodel

Een rol definieert naam, doel, verantwoordelijkheden, bevoegdheden, verboden acties, invoercontract, uitvoercontract, kwaliteitscriteria, escalatieregels, benodigde kennis en runtimebeleid.

De rol is stabiel en versieerbaar. Een rol-instantie is tijdelijk en voert toegewezen taken uit.

## Instantiestatus

`starting`, `idle`, `assigned`, `running`, `waiting`, `stopping`, `stopped`, `failed`.

Meerdere instanties van dezelfde rol zijn toegestaan zolang taken onafhankelijk zijn, resourcegrenzen worden gerespecteerd, gedeelde toestand via de Core loopt en conflicterende writes worden voorkomen.

Een rol mag taken voorstellen maar geen nieuwe bevoegdheden creëren. Per rol worden kwaliteit, doorlooptijd, fouten, herstelpogingen en kosten gemeten. Een taak bewaart de gebruikte rolversie.
