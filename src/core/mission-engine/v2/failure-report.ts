/**
 * Een vastgelopen missie meldt zichzelf.
 *
 * WAAROM DIT BESTAAT
 *
 * Op 20 september 2026 liep een missie vast omdat de Builder een afgekapt
 * testbestand kreeg en daarom weigerde te schrijven. Dat was het juiste
 * gedrag, en de foutmelding was helder — maar hij stond in het logboek van
 * een GitHub Actions-run. Elroy moest die run zelf openklappen, de regel
 * eruit vissen en hem overtypen voordat er iemand naar kon kijken. Precies
 * het postbodewerk waar stap 22 vanaf wilde.
 *
 * Een missie die 's nachts stilvalt terwijl niemand kijkt, is erger: dan
 * staat die melding er de volgende ochtend nog steeds, onopgemerkt, in een
 * logboek dat alleen de eigenaar kan openen.
 *
 * Daarom schrijft het systeem zijn eigen storingen voortaan naar een plek die
 * blijft bestaan en die iedereen kan lezen die de repository kan zien: een
 * GitHub-issue. Geen sleutel nodig, geen login, en het blijft staan tot
 * iemand het sluit.
 *
 * WAT HIER NADRUKKELIJK NIET IN MAG
 *
 * De repository is publiek. Er gaat dus uitsluitend in wat er al publiek is
 * of publiek mag zijn: de missietitel, het missie-id, de status en de
 * foutmelding van de rol. Geen omgevingsvariabelen, geen sleutels, geen
 * bestandsinhoud en geen kennis uit het Second Brain. De foutmeldingen die
 * dit systeem produceert zijn met opzet beschrijvend — als daar ooit een
 * geheim in terechtkomt, is dat een fout op die plek en niet hier, maar de
 * afkapping hieronder beperkt in elk geval de schade.
 */

export const FAILURE_ISSUE_LABEL = "missie-vastgelopen";

/** Hoeveel tekens van de foutmelding er in het issue terechtkomen. */
export const MAX_FAILURE_DETAIL_CHARS = 4_000;

export interface MissionFailure {
  missionId: string;
  title: string;
  /** De status waarin de missie is blijven staan. */
  status: string;
  /** Waarom de lus stopte — de gestructureerde reden, niet de vrije tekst. */
  stoppedReason: string;
  /**
   * De foutcode van de Director, indien aanwezig — bijvoorbeeld
   * `CI_CHECKS_UNVERIFIED` of `QA_VERDICT_STALE`.
   *
   * Dit is het enige veld dat de ene storing van de andere onderscheidt:
   * `stoppedReason` staat bij élke mislukking op DIRECTOR_ERROR, en de
   * foutmelding eronder is vrije tekst die per rol anders geformuleerd is.
   * Zonder de code zien alle meldingen er op het eerste gezicht hetzelfde uit.
   */
  errorCode?: string;
  /** De foutmelding zelf, indien aanwezig. */
  errorMessage?: string;
}

/**
 * De titel draagt het missie-id, en dat is geen opsmuk: het is waarop
 * `findExistingFailureIssue` herkent dat er al een melding openstaat.
 */
export function buildFailureIssueTitle(failure: MissionFailure): string {
  return `Missie vastgelopen: ${failure.title} (${failure.missionId})`;
}

export function buildFailureIssueBody(
  failure: MissionFailure,
  occurredAt: Date = new Date(),
): string {
  const detail = (failure.errorMessage ?? "Geen foutmelding vastgelegd.").slice(
    0,
    MAX_FAILURE_DETAIL_CHARS,
  );

  const truncated = (failure.errorMessage ?? "").length > MAX_FAILURE_DETAIL_CHARS;

  return [
    "Deze melding is automatisch aangemaakt door Mission Engine V2 omdat een missie is gestopt zonder af te ronden.",
    "",
    `- **Missie:** ${failure.title}`,
    `- **Missie-id:** \`${failure.missionId}\``,
    `- **Status:** ${failure.status}`,
    `- **Gestopt omdat:** ${failure.stoppedReason}`,
    `- **Foutcode:** ${failure.errorCode ? `\`${failure.errorCode}\`` : "geen code vastgelegd"}`,
    `- **Tijdstip:** ${occurredAt.toISOString()}`,
    "",
    "### Foutmelding",
    "",
    "```",
    detail,
    ...(truncated ? ["…", `(afgekapt op ${MAX_FAILURE_DETAIL_CHARS} tekens)`] : []),
    "```",
    "",
    "Sluit dit issue zodra de missie weer loopt of is geannuleerd. Zolang het openstaat, wordt er voor deze missie geen tweede melding aangemaakt.",
  ].join("\n");
}

export interface OpenIssue {
  number: number;
  title: string;
  url: string;
}

/**
 * Zoekt een al openstaande melding voor deze missie.
 *
 * Op het missie-id en niet op de titel: een missie kan hernoemd worden, en
 * twee missies kunnen dezelfde titel hebben. Het id is het enige dat niet
 * verandert.
 */
export function findExistingFailureIssue(
  issues: readonly OpenIssue[],
  missionId: string,
): OpenIssue | null {
  return issues.find((issue) => issue.title.includes(missionId)) ?? null;
}
