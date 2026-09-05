/**
 * Eén plek voor de branchnaamgeving van een missie, zodat de Builder (die de
 * branch aanmaakt) en de QA-rol (die de bijbehorende pull request terugvindt)
 * gegarandeerd dezelfde afspraak gebruiken. Dit stond eerder alleen in
 * qa-runtime.ts; sinds de Builder een vaste missiebranch hergebruikt in
 * plaats van per toewijzing een nieuwe aan te maken, hoort de afspraak in een
 * eigen, dependency-vrije module thuis — anders zou builder-runtime.ts de
 * volledige qa-runtime-module moeten importeren voor één string.
 *
 * GEVONDEN ROOT CAUSE (broncodereview, 4 september 2026): elke
 * builder-toewijzing maakte een NIEUWE branch met een tijdstempel, vertrekkend
 * vanaf de standaardbranch, en las de "huidige inhoud" van bestanden ook van
 * de standaardbranch. Een tweede toewijzing binnen dezelfde missie zag het
 * werk van de eerste daardoor niet, en kon dat werk bij het mergen zelfs
 * stilzwijgend overschrijven met de main-versie. De oplossing is één stabiele
 * branch per missie: `MISSION_BRANCH_NAME`.
 *
 * De naam begint bewust met `QA_BRANCH_PREFIX`, zodat `findMissionPullRequest`
 * in qa-runtime.ts ongewijzigd blijft werken — óók voor de oudere,
 * tijdstempel-branches van missies die vóór deze wijziging zijn gestart.
 */
export const QA_BRANCH_PREFIX = (missionId: string) =>
  `director/mission-${missionId.slice(0, 8)}-`;

/**
 * De vaste werkbranch van één missie. Alle builder-toewijzingen van dezelfde
 * missie committen hierop, en alle bestandsinhoud wordt hiervandaan gelezen.
 */
export const MISSION_BRANCH_NAME = (missionId: string) =>
  `${QA_BRANCH_PREFIX(missionId)}work`;
