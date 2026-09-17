/**
 * Stap 19 — de stand van de pull request en de CI, in de app zelf.
 *
 * WAAROM DIT BESTAAT
 *
 * Alles wat hieronder staat was al bekend bij de Matrix: `planMissionRepair`
 * leest de CI-status vóór elke Director-beslissing, QA vergelijkt de branch met
 * de standaardbranch, en de bewijslaag haalt de gewijzigde bestanden op. Alleen
 * kwam er nooit iets van bij de eigenaar terecht.
 *
 * Op 15 september 2026 kostte dat een hele avond. Een missie liep vast, en de
 * enige manier om te zien waaróm was: naar GitHub Actions, de juiste run
 * aanklikken, de job openklappen, en de JSON onderaan het curl-logboek lezen.
 * Twee keer bleek de reden iets wat dit paneel in één regel had kunnen tonen —
 * "de branch loopt een commit achter op main" — en één keer stond het antwoord
 * alleen in de Vercel-logs.
 *
 * WAT HIER WEL EN NIET IN ZIT
 *
 * Wel: de vier dingen waar een missie in de praktijk op vastloopt. Bestaat er
 * een pull request, is de CI groen, loopt de branch achter, en welke bestanden
 * raakt hij. Dat is precies de set die een vastgelopen missie verklaart.
 *
 * Niet: een oordeel over wat de eigenaar nu moet doen. Dat staat al in de
 * Director-beslissing en in de foutmeldingen; dit paneel is een spiegel, geen
 * adviseur. Twee bronnen die hetzelfde zeggen lopen vroeg of laat uiteen.
 *
 * ALLES FAIL-OPEN
 *
 * Elke aanroep hieronder kan mislukken zonder dat er iets stukgaat: GitHub
 * onbereikbaar, een token dat iets niet mag, een branch die niet meer bestaat.
 * Dat levert `null` of een ontbrekend veld op — nooit een uitzondering die het
 * missiepaneel leegtrekt. Dit is een informatiescherm; het mag nooit tussen de
 * eigenaar en zijn missie in gaan staan.
 */

import {
  compareBranches,
  getCombinedCheckStatus,
  getDefaultBranch,
  getGithubRepoTarget,
  getPullRequestFiles,
  listPullRequests,
  type CombinedCheckStatus,
  type GithubRepoTarget,
  type PullRequestSummary,
} from "./github/github-client";
import { QA_BRANCH_PREFIX } from "./mission-branch";
import type { MissionV2 } from "./mission";

/** Hoeveel bestandsnamen er hoogstens meegaan naar de UI. */
export const MAX_PR_STATUS_FILES = 25;

export type MissionPullRequestState = "OPEN" | "MERGED" | "CLOSED";

export interface MissionPullRequestStatus {
  number: number;
  url: string;
  title: string;
  state: MissionPullRequestState;
  /** De CI-stand van de kop van de branch, of null wanneer die niet op te halen was. */
  ci: CombinedCheckStatus | null;
  /**
   * Hoeveel commits de branch achterloopt op de standaardbranch. Null wanneer
   * het niet vast te stellen was.
   *
   * Dit veld staat er niet voor de volledigheid: het is twee keer op één avond
   * de reden geweest dat een missie stilviel, en beide keren was dat alleen te
   * zien door de foutmelding van QA in een GitHub Actions-logboek op te
   * zoeken.
   */
  behindBy: number | null;
  changedFilePaths: string[];
  /** Wanneer deze stand is opgehaald — de UI toont hoe oud het beeld is. */
  checkedAt: string;
}

/**
 * Kiest de pull request die bij deze missie hoort.
 *
 * Bewust ook gesloten en gemergede pull requests: juist ná het mergen wil de
 * eigenaar kunnen zien dát het gemerged is. Meest recente nummer wint, zodat
 * een missie met meerdere (oudere, tijdstempel-)branches de laatste toont.
 */
export function selectMissionPullRequest(
  pullRequests: readonly PullRequestSummary[],
  missionId: string,
): PullRequestSummary | null {
  const prefix = QA_BRANCH_PREFIX(missionId);

  return (
    [...pullRequests]
      .filter((pullRequest) => pullRequest.headRef.startsWith(prefix))
      .sort((a, b) => b.number - a.number)[0] ?? null
  );
}

/**
 * Vertaalt de twee velden die GitHub over een pull request teruggeeft naar één
 * toestand.
 *
 * `merged` heeft voorrang op `state`: een gemergede pull request is bij GitHub
 * óók "closed", en "GESLOTEN" tonen op werk dat gewoon binnen is, is precies
 * het soort verwarring dat dit paneel moet wegnemen.
 */
export function derivePullRequestState(
  pullRequest: Pick<PullRequestSummary, "merged" | "state">,
): MissionPullRequestState {
  if (pullRequest.merged) return "MERGED";

  return pullRequest.state === "closed" ? "CLOSED" : "OPEN";
}

/**
 * Of deze stand iets is waar de eigenaar naar moet kijken.
 *
 * Bewust smal gehouden: alleen een rode CI en een achterlopende branch. Een
 * lopende CI is normaal, en "geen checks" zegt niets — dat als aandachtspunt
 * tonen zou het paneel laten schreeuwen op momenten dat er niets aan de hand
 * is, en dan kijkt niemand er meer naar.
 */
export function needsAttention(status: MissionPullRequestStatus): boolean {
  if (status.ci?.state === "failure") return true;

  return (status.behindBy ?? 0) > 0;
}

/**
 * Haalt de stand op zoals hij nu is.
 *
 * Geeft null wanneer er geen pull request bij deze missie hoort — dat is de
 * normale toestand van elke missie vóór de eerste builder-stap, en dus geen
 * fout. Geeft ook null wanneer GitHub helemaal onbereikbaar is.
 *
 * De drie aanvullende opvragingen (CI, achterstand, bestanden) gaan parallel
 * en zijn ieder apart afgevangen: mislukt er één, dan blijft alleen dát veld
 * leeg in plaats van dat het hele paneel niets laat zien.
 */
export async function getMissionPullRequestStatus(
  mission: MissionV2,
  target: GithubRepoTarget = getGithubRepoTarget(),
): Promise<MissionPullRequestStatus | null> {
  let pullRequest: PullRequestSummary | null;

  try {
    pullRequest = selectMissionPullRequest(await listPullRequests(target, "all"), mission.missionId);
  } catch (error) {
    console.error("Stand van de pull request kon niet worden opgehaald.", error);
    return null;
  }

  if (!pullRequest) return null;

  const state = derivePullRequestState(pullRequest);

  const [ci, behindBy, changedFilePaths] = await Promise.all([
    getCombinedCheckStatus(target, pullRequest.headSha).catch((error) => {
      console.error("CI-stand kon niet worden opgehaald.", error);
      return null;
    }),
    // Een gemergede branch kan niet meer achterlopen, en bestaat vaak niet
    // eens meer — die vergelijking zou dan alleen een 404 opleveren.
    state === "MERGED"
      ? Promise.resolve(null)
      : (async () => {
          try {
            const defaultBranch = await getDefaultBranch(target);
            return (await compareBranches(target, defaultBranch, pullRequest.headRef)).behindBy;
          } catch (error) {
            console.error("Achterstand op de standaardbranch kon niet worden bepaald.", error);
            return null;
          }
        })(),
    getPullRequestFiles(target, pullRequest.number)
      .then((files) => files.map((file) => file.filename).slice(0, MAX_PR_STATUS_FILES))
      .catch((error) => {
        console.error("Gewijzigde bestanden konden niet worden opgehaald.", error);
        return [] as string[];
      }),
  ]);

  return {
    number: pullRequest.number,
    url: pullRequest.url,
    title: pullRequest.title,
    state,
    ci,
    behindBy,
    changedFilePaths,
    checkedAt: new Date().toISOString(),
  };
}
