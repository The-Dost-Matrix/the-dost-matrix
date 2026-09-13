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
 * @param maxLength De maximale lengte van het resultaat; minimaal 5.
 * @returns De originele tekst, of de in het midden ingekorte variant.
 * @throws {Error} Als `maxLength` kleiner is dan 5.
 *
 * @example
 * truncateMiddle('/Users/dost/projects/matrix/src/index.ts', 10);
 * // => '/User….ts'
 */
export function truncateMiddle(value: string, maxLength: number): string {
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
