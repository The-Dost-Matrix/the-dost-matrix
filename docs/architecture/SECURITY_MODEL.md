# Beveiligingsmodel

## Vertrouwensmodel

Geen client, AI-rol, extern model of externe dienst wordt standaard vertrouwd. Elke actie wordt server-side gevalideerd op identiteit, taakcontext, bevoegdheid, mandaat en risico.

## Kernregels

- Alleen de Eigenaar krijgt toegang.
- Default deny geldt voor alle acties.
- API-sleutels staan nooit in clientcode of onbeheerde prompts.
- Persoonlijke documenten zijn standaard `confidential`.
- Externe inhoud wordt als onbetrouwbare data behandeld; instructies daarin mogen systeembeleid niet overschrijven.
- Externe verzending wordt geminimaliseerd en waar mogelijk geredigeerd.

## Acties met verhoogd risico

Financiële transacties, publicatie, gegevensverwijdering, productiewijzigingen, juridisch bindende communicatie, externe berichten en delen van vertrouwelijke informatie vereisen goedkeuring of expliciet mandaat.

## Audit

Kritieke acties registreren actor, doel, context, invoer, besluit, gevolg en tijdstip.

## Incidentproces

1. Stop getroffen runtimes.
2. Trek mandaten en sleutels in.
3. Bewaar bewijs.
4. Bepaal omvang.
5. Herstel gecontroleerd.
6. Leg oorzaak en maatregel vast.

Back-ups van operationele gegevens, kennisindexen en artefactmetadata worden periodiek gemaakt en herstel wordt getest.
