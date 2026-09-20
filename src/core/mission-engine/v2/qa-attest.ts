import type { MissionV2 } from "./mission";

/**
 * Bevinding F-03 uit de externe review van 20 september 2026 — waar sloeg het
 * oordeel van QA ook alweer op?
 *
 * WAT ER MIS WAS
 *
 * QA haalt zijn bewijs op bij `pr.headSha` en zet daarna per succescriterium
 * GEHAALD of NIET GEHAALD op de missie. Dat oordeel droeg alleen nergens de
 * commit met zich mee waar het over ging. Komt er daarna een nieuwe commit op
 * dezelfde pull request, dan blijven die criteria gewoon op GEHAALD staan. Is
 * de CI op die nieuwe commit groen, dan is er niets meer dat tegenhoudt dat er
 * iets gemergd wordt wat nooit inhoudelijk is beoordeeld. De CI-hercontrole
 * vlak voor het mergen vangt dat niet af: die kijkt of de code wérkt, niet of
 * iemand ernaar heeft gekeken.
 *
 * HOE HET NU WORDT VASTGELEGD
 *
 * Er komt geen nieuw veld op de missie en geen nieuw commando in de engine
 * bij. `evaluateCriterion` schrijft al `evidenceRefs` per criterium weg — een
 * lijst met verwijzingen naar het bewijs waarop het oordeel rust. De commit
 * waarop QA keek is precies zo'n verwijzing, dus die hoort daar thuis, met een
 * herkenbaar voorvoegsel ervoor.
 *
 * Dat scheelt een schemawijziging, en het is bovendien eerlijker: het staat
 * bij het oordeel zelf in plaats van ernaast, waar het van dat oordeel los zou
 * kunnen raken.
 *
 * WAT ER GEBEURT MET MISSIES VAN VÓÓR DEZE WIJZIGING
 *
 * Die hebben geen commit bij hun criteria staan. Daar kan niets uit worden
 * afgeleid, dus houdt dit ze niet tegen — ze gedragen zich precies zoals
 * gisteren. Dat is bewust en het is de enige zwakke plek in deze reparatie:
 * voor die missies blijft het oude gat open tot ze klaar zijn. Alles wat QA
 * vanaf nu beoordeelt, draagt de commit wél mee.
 */

export const QA_REVIEWED_SHA_PREFIX = "qa-head-sha:";

export function buildReviewedShaRef(headSha: string): string {
  return `${QA_REVIEWED_SHA_PREFIX}${headSha}`;
}

/**
 * De commits waarop de nog geldende oordelen van QA rusten.
 *
 * Kijkt alleen naar criteria die op GEHAALD staan: een criterium dat niet
 * gehaald is, houdt de missie sowieso al tegen, en of dat oordeel op een oude
 * commit rustte verandert daar niets aan.
 */
export function collectQaReviewedShas(mission: MissionV2): string[] {
  const found = new Set<string>();

  for (const criterion of mission.successCriteria ?? []) {
    if (criterion.status !== "PASSED") continue;

    for (const ref of criterion.evidenceRefs ?? []) {
      if (ref.startsWith(QA_REVIEWED_SHA_PREFIX)) {
        found.add(ref.slice(QA_REVIEWED_SHA_PREFIX.length));
      }
    }
  }

  return [...found];
}

export interface ReviewedPullRequest {
  number: number;
  title: string;
  url: string;
  headSha: string;
}

/**
 * Geeft de reden terug waarom het oordeel van QA niet (meer) bij deze pull
 * request hoort — of null wanneer er niets aan de hand is.
 */
export function findStaleQaReason(
  mission: MissionV2,
  pullRequest: ReviewedPullRequest,
): string | null {
  const reviewed = collectQaReviewedShas(mission);

  // Geen enkele vastgelegde commit: een missie van vóór deze wijziging. Zie
  // de toelichting bovenaan — hier valt niets uit af te leiden, dus houdt dit
  // niets tegen.
  if (reviewed.length === 0) return null;

  if (reviewed.length > 1) {
    return `De succescriteria van deze missie zijn niet allemaal op dezelfde commit beoordeeld (${reviewed
      .map((sha) => sha.slice(0, 7))
      .join(", ")}). Er is dus geen enkele versie waarvan is vastgesteld dat ze er allemaal aan voldoet. Laat QA opnieuw oordelen op de huidige stand van pull request #${pullRequest.number}: ${pullRequest.url}`;
  }

  const [approved] = reviewed;

  if (approved !== pullRequest.headSha) {
    return `QA beoordeelde commit ${approved.slice(0, 7)}, maar pull request #${pullRequest.number} ("${pullRequest.title}") staat inmiddels op ${pullRequest.headSha.slice(0, 7)}. Die nieuwe commit is nooit inhoudelijk beoordeeld, dus er wordt niet gemergd. Laat QA opnieuw oordelen: ${pullRequest.url}`;
  }

  return null;
}
