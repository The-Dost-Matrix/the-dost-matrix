import type { MissionAssignmentRecord, MissionV2 } from "./mission";

const MILLISECONDS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

function parseTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new RangeError(`${field} moet een geldig ISO-tijdstip zijn.`);
  }
  return timestamp;
}

function assertFiniteMilliseconds(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${field} moet een eindig aantal milliseconden zijn.`);
  }
}

function elapsedMilliseconds(start: number, end: number): number {
  // Een klokverschil of een nu-tijdstip vóór de start levert geen negatieve duur op.
  return Math.max(0, end - start);
}

/**
 * Totale doorlooptijd van een missie, inclusief wachten en pauzes.
 *
 * nowMs is een expliciet meegegeven Unix-tijdstip in milliseconden; deze
 * module leest nooit zelf de klok. completedAt heeft voorrang wanneer het
 * aanwezig is. updatedAt is slechts de laatste wijziging en geen eindtijd.
 *
 * Zonder completedAt loopt de duur door tot nowMs, ook bij FAILED of
 * CANCELLED: uit de missiestatus leiden we geen ander eindtijdstip af.
 * Ongeldige gebruikte tijdstempels of een niet-eindige nowMs geven een fout.
 * Een eindtijd vóór createdAt levert nul op.
 */
export function getMissionDurationMs(mission: MissionV2, nowMs: number): number {
  assertFiniteMilliseconds(nowMs, "nowMs");

  const start = parseTimestamp(mission.createdAt, "mission.createdAt");
  const end =
    mission.completedAt !== undefined
      ? parseTimestamp(mission.completedAt, "mission.completedAt")
      : nowMs;

  return elapsedMilliseconds(start, end);
}

/**
 * Verstreken wachttijd op de huidige eigenaarsvraag, in milliseconden.
 * Zonder pendingOwnerInput is er geen openstaande vraag en volgt null.
 *
 * nowMs is een verplicht expliciet Unix-tijdstip in milliseconden en moet
 * eindig zijn, ook zonder openstaande vraag. Een ongeldige requestedAt
 * geeft een fout; een nu-tijdstip vóór requestedAt levert nul op.
 * Alleen pendingOwnerInput bepaalt of er een vraag openstaat.
 */
export function getOwnerInputWaitDurationMs(
  mission: MissionV2,
  nowMs: number,
): number | null {
  assertFiniteMilliseconds(nowMs, "nowMs");

  if (mission.pendingOwnerInput === undefined) {
    return null;
  }

  const start = parseTimestamp(
    mission.pendingOwnerInput.requestedAt,
    "mission.pendingOwnerInput.requestedAt",
  );

  return elapsedMilliseconds(start, nowMs);
}

/**
 * Doorlooptijd van één rol-toewijzing; geen optelsom per roleId en geen
 * meting van uitsluitend actieve werktijd.
 *
 * Eindtijdsemantiek volgt MissionEngine in engine.ts:
 * - DISPATCH_ROLE maakt een ACTIVE record met createdAt en updatedAt gelijk.
 * - recordRoleResult accepteert alleen ACTIVE records, zet updatedAt en
 *   status vanuit het resultaat en verwijdert de actieve assignment-id.
 * - Dit gebeurt ook bij WAITING_FOR_INPUT. recordOwnerInput hervat de
 *   missie, maar zet dat toewijzingsrecord niet opnieuw op ACTIVE.
 *
 * Daarom loopt ACTIVE tot nowMs en eindigen COMPLETED, FAILED, CANCELLED
 * én WAITING_FOR_INPUT bij updatedAt: het moment waarop het rolresultaat
 * werd geregistreerd. Wachten op de eigenaar ná dat resultaat hoort bij
 * de missieduur, niet bij deze afgesloten uitvoeringspoging.
 *
 * updatedAt wordt dus niet algemeen als eindtijd beschouwd: bij ACTIVE
 * wordt het genegeerd. De status van de bovenliggende missie verandert
 * deze berekening niet; alleen dit record bevat de gebruikte tijdstempels.
 *
 * nowMs is een expliciet Unix-tijdstip in milliseconden. Ongeldige gebruikte
 * tijdstempels of een niet-eindige nowMs geven een fout; een eindtijd vóór
 * createdAt levert nul op.
 */
export function getAssignmentDurationMs(
  assignment: MissionAssignmentRecord,
  nowMs: number,
): number {
  assertFiniteMilliseconds(nowMs, "nowMs");

  const start = parseTimestamp(assignment.createdAt, "assignment.createdAt");
  const end =
    assignment.status === "ACTIVE"
      ? nowMs
      : parseTimestamp(assignment.updatedAt, "assignment.updatedAt");

  return elapsedMilliseconds(start, end);
}

/**
 * Korte Nederlandse duurtekst:
 * - onder een minuut: hele seconden;
 * - onder een uur: hele minuten;
 * - vanaf een uur: uren en, indien niet nul, resterende hele minuten.
 *
 * Kleinere eenheden worden naar beneden afgerond. Uren lopen door boven
 * 24 uur. Negatieve waarden worden nul; niet-eindige waarden geven een fout.
 *
 * Voorbeelden: "42 seconden", "7 minuten", "2 uur 15 minuten".
 */
export function formatDurationNl(durationMs: number): string {
  assertFiniteMilliseconds(durationMs, "durationMs");

  const seconds = Math.floor(Math.max(0, durationMs) / MILLISECONDS_PER_SECOND);
  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds} ${seconds === 1 ? "seconde" : "seconden"}`;
  }

  const totalMinutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (totalMinutes < MINUTES_PER_HOUR) {
    return `${totalMinutes} ${totalMinutes === 1 ? "minuut" : "minuten"}`;
  }

  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (minutes === 0) {
    return `${hours} uur`;
  }

  return `${hours} uur ${minutes} ${minutes === 1 ? "minuut" : "minuten"}`;
}
