/**
 * Kort een tekst in door het MIDDEN te vervangen door het ellipsis-teken '…'
 * (U+2026), zodat begin en eind zichtbaar blijven — handig voor bijvoorbeeld
 * lange bestandspaden.
 *
 * Is `value` korter dan of gelijk aan `maxLength`, dan komt `value` ongewijzigd
 * terug. Wordt er wel ingekort, dan is het resultaat altijd exact `maxLength`
 * tekens lang. Bij een oneven aantal over te houden tekens krijgt het begin het
 * extra teken.
 *
 * @param value De tekst die eventueel ingekort wordt.
 * @param maxLength De maximale lengte van het resultaat; een geheel getal van
 *   minimaal 5.
 * @returns De originele tekst, of de in het midden ingekorte variant.
 * @throws {Error} Als `maxLength` geen geheel getal is, of kleiner dan 5.
 *
 * @example
 * truncateMiddle('/Users/dost/projects/matrix/src/index.ts', 10);
 * // => '/User…x.ts'
 */
export function truncateMiddle(value: string, maxLength: number): string {
  // Beide controles zijn toegevoegd na de geautomatiseerde beoordeling van
  // pull request #59, die twee dingen aanwees die klopten.
  //
  // Het voorbeeld hierboven zei '/User….ts' — negen tekens, terwijl de functie
  // er tien teruggeeft. De documentatie loog dus over de eigen functie.
  //
  // En `maxLength` is een `number`, dus 5.5 kwam ongehinderd door de controle
  // hieronder: `keep` werd 4.5, `Math.ceil` maakte er 3 van en `Math.floor` 2,
  // plus het ellipsis-teken — zes tekens, terwijl de belofte "altijd exact
  // maxLength tekens" is. Een gebroken belofte die niemand zou zien, want er
  // komt gewoon een plausibel ogende tekst uit. Vandaar een aparte controle met
  // een eigen foutmelding: "geen geheel getal" en "te klein" zijn twee
  // verschillende vergissingen en verdienen twee verschillende meldingen.
  if (!Number.isInteger(maxLength)) {
    throw new Error("maxLength moet een geheel getal zijn.");
  }

  if (maxLength < 5) {
    throw new Error("maxLength moet minimaal 5 zijn.");
  }

  if (value.length <= maxLength) {
    return value;
  }

  const keep = maxLength - 1;
  const start = Math.ceil(keep / 2);
  const end = Math.floor(keep / 2);

  return value.slice(0, start) + "…" + (end > 0 ? value.slice(value.length - end) : "");
}
