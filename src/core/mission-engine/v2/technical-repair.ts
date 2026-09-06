import type { MissionV2 } from "./mission";

/**
 * Technische herstellus (roadmapstap 11, deel 2).
 *
 * WAT DIT OPLOST
 *
 * Tot nu toe stopte een missie bij een rode CI en stapte de eigenaar zelf in:
 * hij las op GitHub wat er stuk was, en gaf de Builder met de hand een nieuwe
 * opdracht. Dat is de correctielus waar stap 11 hem uit haalt.
 *
 * Vanaf nu stuurt de Director de Builder zelf terug zodra de CI faalt, mét de
 * echte foutmelding erbij (zie ci-failure-report.ts uit deel 1). De
 * herstelpoging is een nieuwe commit op dezelfde missiebranch — sinds stap 9
 * is dat veilig: die branch is de enige werkplek van de missie, dus een
 * herstelpoging bouwt voort op het vorige werk in plaats van het terug te
 * draaien.
 *
 * BEWUST BEGRENSD
 *
 * Drie pogingen, meer niet. Een model dat er drie keer niet uitkomt, komt er
 * de vierde keer meestal ook niet uit, en ondertussen kost elke poging geld
 * en wachttijd. Na de derde poging stopt de missie met een gestructureerde
 * fout in plaats van door te blijven proberen — dezelfde keuze als bij
 * INSUFFICIENT_CONTEXT in stap 10: liever expliciet stoppen dan eindeloos
 * gokken.
 *
 * Deze module is volledig zonder netwerk: alleen tellen en tekst opbouwen.
 * Het ophalen bij GitHub gebeurt in director-runtime.ts. Dezelfde scheiding
 * als bij context-resolver.ts en ci-failure-report.ts, en om dezelfde reden:
 * zo is het gedrag hier zonder GitHub aantoonbaar te testen.
 */

/** Waarde van `kind` op een toewijzing die een herstelpoging is. */
export const TECHNICAL_REPAIR_KIND = "TECHNICAL_REPAIR";

/** Harde bovengrens op het aantal herstelpogingen per missie. */
export const MAX_TECHNICAL_REPAIR_ATTEMPTS = 3;

/**
 * Hoeveel herstelpogingen deze missie al achter de rug heeft.
 *
 * Geteld op het veld `kind` van de toewijzing, niet op de bewoording van de
 * opdrachttekst. Dat is dezelfde les als bij stap 5 (gestructureerde
 * foutcodes in plaats van string-matching): zodra je je eigen tekst gaat
 * herkennen, breekt het bij de eerste herformulering.
 *
 * Toewijzingen van vóór deze wijziging hebben helemaal geen `kind` en tellen
 * dus als nul — precies goed, want dat waren geen herstelpogingen.
 */
export function countTechnicalRepairAttempts(mission: MissionV2): number {
  return mission.assignments.filter((assignment) => assignment.kind === TECHNICAL_REPAIR_KIND)
    .length;
}

/** Of het plafond is bereikt en er dus niet nóg een poging mag komen. */
export function hasExhaustedTechnicalRepair(
  mission: MissionV2,
  maxAttempts: number = MAX_TECHNICAL_REPAIR_ATTEMPTS,
): boolean {
  return countTechnicalRepairAttempts(mission) >= maxAttempts;
}

export interface TechnicalRepairObjectiveInput {
  /** Hoeveelste poging dit wordt, tellend vanaf 1. */
  attempt: number;
  maxAttempts: number;
  pullRequestNumber: number;
  /** Bestanden die deze missie tot nu toe heeft gewijzigd, volgens GitHub. */
  changedFilePaths: readonly string[];
  /** Het verslag uit ci-failure-report.ts. */
  failureReport: string;
}

/**
 * De opdrachttekst die de herstellende Builder krijgt.
 *
 * Drie dingen staan er bewust in, en alle drie om dezelfde reden als het
 * contextmanifest van stap 10: de Builder moet weten wat hij weet.
 *
 * 1. De echte foutmelding, niet alleen de naam van de gefaalde controle.
 * 2. De lijst bestanden die deze missie al heeft gewijzigd — hij mag de fout
 *    dáár oplossen en nergens anders. Zonder die grens is de kans reëel dat
 *    hij een ongerelateerd bestand "meeneemt" om de fout te laten verdwijnen.
 * 3. Het expliciete verbod om een test of controle uit te zetten. Een falende
 *    typecheck laten slagen door de regel te verwijderen is technisch een
 *    groene CI en inhoudelijk een leugen; dat moet er letterlijk staan.
 */
export function buildTechnicalRepairObjective({
  attempt,
  maxAttempts,
  pullRequestNumber,
  changedFilePaths,
  failureReport,
}: TechnicalRepairObjectiveInput): string {
  const fileList =
    changedFilePaths.length > 0
      ? changedFilePaths.map((path) => `- ${path}`).join("\n")
      : "- (GitHub gaf geen gewijzigde bestanden terug voor deze pull request)";

  return [
    `HERSTELOPDRACHT (poging ${attempt} van ${maxAttempts}).`,
    "",
    `De CI-controle op pull request #${pullRequestNumber} is mislukt. Los uitsluitend die fout op. Dit is geen nieuwe opdracht: het werk dat er al staat blijft staan.`,
    "",
    "Bestanden die deze missie tot nu toe heeft gewijzigd — beperk je hiertoe:",
    fileList,
    "",
    "Regels voor deze herstelpoging:",
    "- Los de oorzaak op die in de foutmelding hieronder staat, en niets anders.",
    "- Zet nooit een test, controle of typecontrole uit om de fout te laten verdwijnen, en verwijder geen bestaande tests. Een groene CI die is bereikt door de controle weg te halen, telt als mislukt.",
    "- Verwijder geen bestaande functionaliteit die niets met de fout te maken heeft.",
    "- Gebruik uitsluitend namen, parameters en importpaden die je daadwerkelijk in de aangeleverde bestandsinhoud ziet staan; verzin niets.",
    "",
    "De foutmelding van de mislukte CI-controle:",
    "",
    failureReport,
  ].join("\n");
}

export interface TechnicalRepairReasonInput {
  attempt: number;
  maxAttempts: number;
  pullRequestNumber: number;
  failingCheckNames: readonly string[];
}

/**
 * De toelichting die de eigenaar in de app te zien krijgt bij deze stap.
 * Kort en feitelijk: wat er gebeurde, de hoeveelste poging dit is, en dat
 * dit besluit niet van een taalmodel komt maar van een vaste regel.
 */
export function buildTechnicalRepairReason({
  attempt,
  maxAttempts,
  pullRequestNumber,
  failingCheckNames,
}: TechnicalRepairReasonInput): string {
  const checks =
    failingCheckNames.length > 0 ? failingCheckNames.join(", ") : "onbekende controle";

  return `De CI-controle op pull request #${pullRequestNumber} is mislukt (${checks}). De Builder krijgt de foutmelding terug om het zelf op te lossen — herstelpoging ${attempt} van ${maxAttempts}. Dit is een vaste regel, geen afweging van het taalmodel.`;
}

/**
 * De melding wanneer het plafond is bereikt. Bewust volledig: de eigenaar
 * moet hieruit kunnen opmaken wat er is geprobeerd en waar hij verder moet
 * kijken, zonder eerst de missie te hoeven uitpluizen.
 */
export function buildTechnicalRepairExhaustedMessage(
  maxAttempts: number,
  pullRequestNumber: number,
  pullRequestUrl: string,
  failingCheckNames: readonly string[],
): string {
  const checks =
    failingCheckNames.length > 0 ? failingCheckNames.join(", ") : "onbekende controle";

  return `De CI-controle op pull request #${pullRequestNumber} faalt nog steeds (${checks}) na ${maxAttempts} automatische herstelpogingen. De Director stopt hier bewust met proberen: nog een poging kost geld en wachttijd zonder dat er reden is om aan te nemen dat het deze keer wél lukt. Bekijk de pull request zelf en beslis wat er moet gebeuren — herstellen met de hand, de missie opnieuw plannen, of annuleren: ${pullRequestUrl}`;
}
