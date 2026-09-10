import type { MissionV2 } from "./mission";

/**
 * Vraag-aan-de-eigenaar bij twijfel (roadmapstap 12b).
 *
 * WAT DIT OPLOST
 *
 * Twee situaties liepen tot nu toe dood in plaats van door te lopen:
 *
 * 1. QA kon een succescriterium niet vaststellen (zie CriterionStatus in
 *    mission.ts — de nieuwe waarde "UNDETERMINED"). Vóór stap 12b bestond dat
 *    oordeel niet: QA moest altijd kiezen tussen GEHAALD en NIET GEHAALD, ook
 *    wanneer geen van beide eerlijk was. Een geforceerd NIET GEHAALD startte
 *    dan een inhoudelijke herstellus (zie semantic-repair.ts) die nooit kon
 *    slagen, omdat er niets inhoudelijk mis was om te herstellen — alleen
 *    iets om vast te stellen.
 * 2. De inhoudelijke herstellus zelf (semantic-repair.ts) stopte na het
 *    bereiken van MAX_SEMANTIC_REPAIR_ATTEMPTS met een harde fout
 *    (SEMANTIC_REPAIR_EXHAUSTED) — de missie liep vast en de eigenaar moest
 *    dat zelf via de foutmelding ontdekken en de missie met de hand oplossen
 *    of annuleren.
 *
 * Beide situaties krijgen nu dezelfde afhandeling: in plaats van te stoppen,
 * stelt de Director de vraag aan de eigenaar (DirectorDecisionType
 * "REQUEST_OWNER_INPUT", zie director-runtime.ts), met het criterium, de
 * twijfel van QA en — indien beschikbaar — het weerwoord van de Builder erbij
 * (diens laatste toewijzingssamenvatting, zie
 * MissionAssignmentRecord.resultSummary in mission.ts). De eigenaar
 * antwoordt gehaald/niet gehaald met een reden (zie recordOwnerInput in
 * engine.ts), en de missie loopt daarna gewoon door — precies zoals bij elk
 * ander criterium dat door QA is beoordeeld.
 *
 * Bewust GEEN generieke "QA overrulen"-knop: dit sluit alleen de twee
 * hierboven genoemde, specifieke doodlopende paden.
 *
 * Volledig zonder netwerk: alleen lezen van de missie en tekst opbouwen. Het
 * daadwerkelijk stellen van de vraag (via engine.applyDirectorDecision)
 * gebeurt in director-runtime.ts — dezelfde scheiding als bij
 * technical-repair.ts en semantic-repair.ts, en om dezelfde reden: zo is het
 * gedrag hier zonder GitHub of een LLM aantoonbaar te testen.
 */

export interface OwnerClarificationCriterion {
  criterionId: string;
  description: string;
  /** De toelichting van QA bij dit criterium, indien gegeven. */
  qaDoubt: string | null;
}

/**
 * De criteria die QA niet kon vaststellen (situatie 1 hierboven).
 *
 * Zelfde vorm als collectFailedCriteria in semantic-repair.ts, met opzet:
 * beide worden in director-runtime.ts naast elkaar gebruikt om een
 * OwnerClarificationQuestionInput samen te stellen.
 */
export function collectUndeterminedCriteria(mission: MissionV2): OwnerClarificationCriterion[] {
  return mission.successCriteria
    .filter((criterion) => criterion.status === "UNDETERMINED")
    .map((criterion) => ({
      criterionId: criterion.criterionId,
      description: criterion.description,
      qaDoubt: criterion.lastEvaluationNote?.trim() || null,
    }));
}

/**
 * Het weerwoord van de Builder op een eerder QA-oordeel, indien beschikbaar.
 *
 * Mission Engine V2 bewaart de volledige inhoud van een RoleResult verder
 * nergens doorzoekbaar (zie de toelichting bij findMissionPullRequest in
 * qa-runtime.ts) — daarom leunt dit op MissionAssignmentRecord.resultSummary,
 * dat engine.ts sinds stap 12b bij elk rolresultaat bijwerkt. Neemt de
 * meest recente AFGERONDE builder-toewijzing met een niet-lege samenvatting;
 * geeft null wanneer de Builder nog niets heeft opgeleverd.
 */
export function findLatestBuilderRebuttal(mission: MissionV2): string | null {
  const withSummary = mission.assignments
    .filter(
      (assignment) =>
        assignment.roleId === "builder" &&
        assignment.status === "COMPLETED" &&
        assignment.resultSummary?.trim(),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return withSummary[0]?.resultSummary?.trim() || null;
}

export interface OwnerClarificationQuestionInput {
  /**
   * De introductietekst: wat er aan de hand is en waarom de eigenaar dit nu
   * te zien krijgt. Voor situatie 1 stelt director-runtime.ts deze zelf op;
   * voor situatie 2 hergebruikt het de kant-en-klare
   * buildSemanticRepairExhaustedMessage uit semantic-repair.ts, zodat die
   * tekst niet dubbel wordt onderhouden.
   */
  intro: string;
  criteria: readonly OwnerClarificationCriterion[];
  builderRebuttal: string | null;
}

/**
 * De vraagtekst die de eigenaar te zien krijgt.
 *
 * Het EERSTE criterium in `criteria` is leidend voor het antwoord (zie
 * relatedCriterionId op DirectorDecision/PendingOwnerInput) — bij meerdere
 * staan de overige er alleen ter toelichting bij. Dezelfde "arbitrair maar
 * niet leeg laten vervallen"-aanpak als bij applyBlockingRecommendation in
 * qa-runtime.ts: v0 lost er één per keer op, en de rest komt vanzelf terug
 * zodra de Director na het antwoord opnieuw een stap zet.
 */
export function buildOwnerClarificationQuestion({
  intro,
  criteria,
  builderRebuttal,
}: OwnerClarificationQuestionInput): string {
  const [primary, ...rest] = criteria;
  const lines = [intro];

  if (primary) {
    lines.push("", `Criterium waar dit om gaat: "${primary.description}"`);
    lines.push(
      primary.qaDoubt
        ? `Oordeel/twijfel van QA: ${primary.qaDoubt}`
        : "QA gaf hierbij geen nadere toelichting.",
    );
  }

  if (builderRebuttal) {
    lines.push("", `Weerwoord van de Builder (laatste toewijzing): ${builderRebuttal}`);
  }

  if (rest.length > 0) {
    lines.push(
      "",
      `Er staan nog ${rest.length} ander(e) succescriterium/criteria open om dezelfde reden: ${rest
        .map((criterion) => `"${criterion.description}"`)
        .join(", ")}. Los eerst het bovenstaande criterium op — de overige komen na een volgende stap van de Director opnieuw aan bod.`,
    );
  }

  lines.push(
    "",
    'Beantwoord dit criterium met "gehaald" of "niet gehaald" en geef een korte reden — die reden wordt bij het criterium bewaard en de missie loopt daarna door.',
  );

  return lines.join("\n");
}
