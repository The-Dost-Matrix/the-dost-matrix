/**
 * Zet een bedrag in centen om naar een leesbare euro-string.
 *
 * Het resultaat gebruikt altijd een spatie na het euroteken, een komma als
 * decimaalscheiding en exact twee decimalen. Er wordt geen duizendtalscheiding
 * toegepast, zodat de uitvoer voorspelbaar en locale-onafhankelijk blijft.
 *
 * Niet-eindige of niet-numerieke invoer wordt behandeld als 0. Bedragen met
 * fracties van centen worden afgerond naar de dichtstbijzijnde hele cent.
 *
 * @param cents - Het bedrag in centen (bijv. 1234 voor twaalf euro en 34 cent).
 * @returns Het geformatteerde bedrag, bijv. `'€ 12,34'`.
 *
 * @example
 * formatCents(1200); // '€ 12,00'
 * formatCents(1234); // '€ 12,34'
 * formatCents(0); // '€ 0,00'
 * formatCents(5); // '€ 0,05'
 * formatCents(-1234); // '€ -12,34'
 */
export function formatCents(cents: number): string {
  const safeCents =
    typeof cents === 'number' && Number.isFinite(cents) ? Math.round(cents) : 0;

  const isNegative = safeCents < 0;
  const absoluteCents = Math.abs(safeCents);

  const euros = Math.floor(absoluteCents / 100);
  const remainder = absoluteCents % 100;

  const sign = isNegative ? '-' : '';
  const decimals = String(remainder).padStart(2, '0');

  return `€ ${sign}${euros},${decimals}`;
}
