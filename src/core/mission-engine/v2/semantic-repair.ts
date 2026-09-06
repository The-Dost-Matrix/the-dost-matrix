import type { MissionV2 } from "./mission";

/**
 * Inhoudelijke herstellus (roadmapstap 12, deel 1).
 *
 * WAT DIT OPLOST
 *
 * Stap 11 gaf de technische fout een lus met een plafond: faalt de CI, dan
 * krijgt de Builder de foutmelding terug, maximaal drie keer. Voor de
 * inhoudelijke fout — de CI is groen, maar QA keurt een succescriterium af —
 * bestond zoiets niet. De Director stuurde de Builder dan via het taalmodel
 * terug, en bleef dat doen zolang QA bleef afkeuren.
 *
 * Bij regressietest D gebeurde dat live: drie extra toewijzingen achter
 * elkaar, zeven commits op één pull request, kosten van 12 naar 63 cent, en
 * alleen te stoppen doordat de eigenaar zelf ingreep. De lus had geen
 * plafond, geen teller en geen einde.
 *
 * Deze module geeft de inhoudelijke fout dezelfde behandeling als de
 * technische. Bewust apart gehouden en niet samengevoegd: een compileerfout
 * en een inhoudelijk bezwaar zijn verschillende soorten problemen, ze vragen
 * een andere opdracht, en drie mislukte compileerreparaties zeggen niets over
 * hoeveel inhoudelijke rondes nog zinvol zijn.
 *
 * WAAROM DE OPDRACHT HIER WORDT OPGESTELD EN NIET DOOR HET TAALMODEL
 *
 * Bij test D vroeg de Director de Builder om "bewijs van groene runs" te
 * leveren. De Builder kan niets uitvoeren; hij schrijft alleen bestanden. Die
 * opdracht kon dus per definitie niet slagen. Door de tekst hier vast te
 * leggen kan zoiets niet meer ontstaan, en staat er in plaats daarvan
 * expliciet wat de Builder moet doen als een criterium iets vraagt dat buiten
 * zijn vermogen ligt: dat zeggen, niet doen alsof.
 *
 * Volledig zonder netwerk: alleen tellen, kiezen en tekst opbouwen.
 */

/** Waarde van `kind` op een toewijzing die een inhoudelijke herstelpoging is. */
export const SEMANTIC_REPAIR_KIND = "SEMANTIC_REPAIR";

/**
 * Harde bovengrens op het aantal inhoudelijke herstelpogingen per missie.
 *
 * Twee, niet drie. Een inhoudelijk bezwaar van QA gaat over een oordeel, niet
 * over een aantoonbare fout: blijft het na twee gerichte rondes staan, dan is
 * de kans groot dat het bezwaar zelf niet klopt (zoals bij test D, waar QA
 * afkeurde op iets dat hij niet kón zien) of dat het criterium verkeerd is
 * geformuleerd. Beide vragen een mens, geen derde poging.
 */
export const MAX_SEMANTIC_REPAIR_ATTEMPTS = 2;

/** Hoeveel inhoudelijke herstelpogingen deze missie al achter de rug heeft. */
export function countSemanticRepairAttempts(mission: MissionV2): number {
  return mission.assignments.filter((assignment) => assignment.kind === SEMANTIC_REPAIR_KIND)
    .length;
}

export interface FailedCriterion {
  criterionId: string;
  description: string;
  note: string | null;
}

/**
 * De afgekeurde succescriteria, met de toelichting die QA erbij gaf.
 *
 * Die toelichting staat al op de missie (`lastEvaluationNote`, gezet door
 * `evaluateCriterion`) en is precies wat de Builder nodig heeft: niet dát een
 * criterium is afgekeurd, maar waaróm.
 */
export function collectFailedCriteria(mission: MissionV2): FailedCriterion[] {
  return mission.successCriteria
    .filter((criterion) => criterion.status === "FAILED")
    .map((criterion) => ({
      criterionId: criterion.criterionId,
      description: criterion.description,
      note: criterion.lastEvaluationNote?.trim() || null,
    }));
}

export interface SemanticRepairObjectiveInput {
  attempt: number;
  maxAttempts: number;
  pullRequestNumber: number;
  changedFilePaths: readonly string[];
  failedCriteria: readonly FailedCriterion[];
}

/**
 * De opdrachttekst voor een inhoudelijke herstelpoging.
 *
 * Het verschil met de technische herstelopdracht: daar staat een objectieve
 * foutmelding in, hier het oordeel van een andere rol. Dat oordeel kan fout
 * zijn — bij test D wás het fout. Daarom staat er expliciet in dat de Builder
 * mag tegenspreken in plaats van iets kapot te maken om QA tevreden te
 * stellen. Een Builder die een correcte test aanpast omdat QA hem verkeerd
 * las, maakt het werk slechter.
 */
export function buildSemanticRepairObjective({
  attempt,
  maxAttempts,
  pullRequestNumber,
  changedFilePaths,
  failedCriteria,
}: SemanticRepairObjectiveInput): string {
  const fileList =
    changedFilePaths.length > 0
      ? changedFilePaths.map((path) => `- ${path}`).join("\n")
      : "- (GitHub gaf geen gewijzigde bestanden terug voor deze pull request)";

  const criteriaList = failedCriteria
    .map((criterion) =>
      [
        `- Criterium: ${criterion.description}`,
        `  Oordeel van QA: ${criterion.note ?? "(QA gaf geen toelichting)"}`,
      ].join("\n"),
    )
    .join("\n");

  return [
    `INHOUDELIJKE HERSTELOPDRACHT (poging ${attempt} van ${maxAttempts}).`,
    "",
    `De CI-controle op pull request #${pullRequestNumber} slaagt: de code compileert en de tests draaien. QA heeft echter een of meer succescriteria afgekeurd. Dit is geen nieuwe opdracht — het werk dat er staat blijft staan.`,
    "",
    "Bestanden die deze missie tot nu toe heeft gewijzigd — beperk je hiertoe:",
    fileList,
    "",
    "Afgekeurde criteria, met het oordeel van QA:",
    criteriaList,
    "",
    "Regels voor deze herstelpoging:",
    "- Pak uitsluitend de criteria hierboven aan.",
    "- Het oordeel van QA kan onjuist zijn: hij ziet niet altijd alle bronbestanden. Klopt zijn bezwaar aantoonbaar niet, verander de code dan NIET. Leg in je samenvatting uit waarom het bezwaar niet opgaat, met verwijzing naar wat er daadwerkelijk in de bestanden staat.",
    "- Verzwak nooit een test om aan een bezwaar tegemoet te komen, en verwijder geen bestaande tests of controles.",
    "- Je kunt zelf niets uitvoeren: je schrijft alleen bestanden. Vraagt een criterium om iets dat je niet kunt aantonen door bestanden te schrijven — bijvoorbeeld het draaien van een commando — zeg dat dan in je samenvatting, in plaats van te doen alsof je het hebt gedaan.",
    "- Gebruik uitsluitend namen, parameters en importpaden die je daadwerkelijk in de aangeleverde bestandsinhoud ziet staan.",
  ].join("\n");
}

export interface SemanticRepairReasonInput {
  attempt: number;
  maxAttempts: number;
  pullRequestNumber: number;
  failedCriteriaCount: number;
}

/** De toelichting die de eigenaar in de app te zien krijgt bij deze stap. */
export function buildSemanticRepairReason({
  attempt,
  maxAttempts,
  pullRequestNumber,
  failedCriteriaCount,
}: SemanticRepairReasonInput): string {
  const subject =
    failedCriteriaCount === 1 ? "één succescriterium" : `${failedCriteriaCount} succescriteria`;

  return `De CI op pull request #${pullRequestNumber} is groen, maar QA heeft ${subject} afgekeurd. De Builder krijgt het oordeel van QA terug om het gericht op te lossen — inhoudelijke herstelpoging ${attempt} van ${maxAttempts}. Dit is een vaste regel, geen afweging van het taalmodel.`;
}

/**
 * De melding wanneer het plafond is bereikt.
 *
 * Bewust anders van toon dan bij de technische lus: daar staat vast dát er
 * iets stuk is. Hier is het maar de vraag — het kan net zo goed aan het
 * oordeel of aan de formulering van het criterium liggen. Die twee
 * mogelijkheden staan er allebei in, zodat de eigenaar niet automatisch naar
 * de code gaat zoeken.
 */
export function buildSemanticRepairExhaustedMessage(
  maxAttempts: number,
  pullRequestNumber: number,
  pullRequestUrl: string,
  failedCriteria: readonly FailedCriterion[],
): string {
  const list = failedCriteria.map((criterion) => `"${criterion.description}"`).join(", ");

  return `Na ${maxAttempts} inhoudelijke herstelpogingen keurt QA nog steeds af: ${list}. De CI is groen, dus de code compileert en de tests draaien — het gaat hier om een oordeel, niet om een aantoonbare fout. De Director stopt daarom met proberen. Drie dingen zijn even waarschijnlijk: het bezwaar van QA klopt, QA mist context om het goed te kunnen beoordelen, of het criterium is zo geformuleerd dat het niet te bewijzen valt. Bekijk de pull request en beslis zelf: ${pullRequestUrl}`;
}
