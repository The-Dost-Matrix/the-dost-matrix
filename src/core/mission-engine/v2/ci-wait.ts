/**
 * Binnen dezelfde aanroep wachten tot de CI van een missie klaar is.
 *
 * WAAROM DIT BESTAAT
 *
 * Op 14 september 2026 is de autonome lus gaan pauzeren na elke builder-stap
 * (zie de toelichting bovenaan autonomous-advance.ts): GitHub had op dat
 * moment nog geen enkele check-run geregistreerd, en QA beoordeelde daardoor
 * code die nog nooit gecompileerd was. Die pauze klopt, en blijft.
 *
 * De prijs was dat een missie voortaan één extra tik nodig had per
 * builder-stap. Die prijs leek klein — tien minuten — tot bleek dat de tik
 * helemaal niet elke tien minuten draait. GitHub noemt zijn schedule-trigger
 * "best effort" en knijpt hem in de praktijk hard af: in de eerste dag stonden
 * er elf runs waar er honderden hadden moeten staan, uren uit elkaar, en een
 * overgeslagen run laat geen enkel spoor na. Elke pauze werd daarmee geen tien
 * minuten maar een paar uur, en een missie met twee builder-stappen kon zo een
 * halve dag duren.
 *
 * DE OPLOSSING: NIET MINDER PAUZEREN, MAAR KORTER
 *
 * De CI van dit project doet er ongeveer twee minuten over (`npm ci`,
 * typecheck, importcontrole, de testsuite). Een Vercel-functie mag er 300
 * draaien. Er is dus ruimte om de uitkomst gewoon af te wachten in plaats van
 * de missie weg te leggen tot de volgende tik.
 *
 * Lukt dat binnen de tijd, dan loopt de missie in één tik door van bouwen naar
 * QA naar mergen. Lukt het niet, dan valt alles terug op het oude gedrag: de
 * missie stopt met WAITING_FOR_CI en de volgende tik pakt hem op. Het wachten
 * is dus een versnelling, nooit een voorwaarde.
 *
 * WAAROM ER NIETS WORDT DOORGELATEN BIJ TWIJFEL
 *
 * Alleen een afgeronde uitkomst — geslaagd of gefaald — telt als "klaar". Geen
 * check-runs gevonden ("none") telt hier NIET als klaar, want dat is precies
 * de toestand vlak na een push waar de hele pauze voor bestaat. Blijft het
 * daarbij tot de tijd op is, dan stopt de missie gewoon; de volgende tik weet
 * er dan wél raad mee (zie `planMissionRepair` in director-runtime.ts, dat
 * "none" na verloop van tijd terecht als "deze repository heeft geen CI"
 * behandelt).
 *
 * Een fout bij GitHub leidt om dezelfde reden tot stoppen en niet tot
 * doorgaan: doorgaan zou betekenen dat er weer geoordeeld wordt op een
 * onbekende CI-stand, en dat is nu juist de bug die dit alles heeft veroorzaakt.
 */

import { getCombinedCheckStatus, getGithubRepoTarget, listPullRequests } from "./github/github-client";
import { QA_BRANCH_PREFIX } from "./mission-branch";

/** Hoe lang er maximaal op de CI gewacht wordt binnen één aanroep. */
export const MAX_CI_WAIT_MS = 180_000;

/** Tijd tussen twee opvragingen van de CI-stand. */
export const CI_POLL_INTERVAL_MS = 15_000;

/**
 * Marge die vóór `deadlineAt` vrij blijft, zodat er ná het wachten nog tijd
 * is om daadwerkelijk een volgende stap te zetten. Zonder deze marge zou het
 * wachten de hele aanroep kunnen opeten en zou de winst nul zijn.
 */
export const CI_WAIT_DEADLINE_RESERVE_MS = 60_000;

export type CiWaitOutcome = "SETTLED" | "TIMED_OUT" | "NO_PULL_REQUEST" | "ERROR";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wacht tot de CI van de missiebranch een afgeronde uitkomst heeft.
 *
 * "SETTLED" betekent alleen dat er een uitkomst ís — niet dat die groen is.
 * Wat er met een rode CI moet gebeuren, beslist de Director (technische
 * herstellus, stap 11), niet deze functie.
 *
 * `NO_PULL_REQUEST` is geen fout: een builder-toewijzing die niets te
 * committen had, laat niets achter om op te wachten. De lus mag dan gewoon
 * door.
 */
export async function waitForMissionChecks(
  missionId: string,
  options: { deadlineAt: number; now?: () => number; wait?: (ms: number) => Promise<void> },
): Promise<CiWaitOutcome> {
  const now = options.now ?? (() => Date.now());
  const wait = options.wait ?? sleep;

  const startedAt = now();
  const budgetEndsAt = Math.min(
    startedAt + MAX_CI_WAIT_MS,
    options.deadlineAt - CI_WAIT_DEADLINE_RESERVE_MS,
  );

  if (budgetEndsAt <= startedAt) return "TIMED_OUT";

  const target = getGithubRepoTarget();
  const prefix = QA_BRANCH_PREFIX(missionId);

  try {
    const prs = await listPullRequests(target, "open");
    const pullRequest = prs
      .filter((pr) => pr.headRef.startsWith(prefix))
      .sort((a, b) => b.number - a.number)[0];

    if (!pullRequest) return "NO_PULL_REQUEST";

    for (;;) {
      const status = await getCombinedCheckStatus(target, pullRequest.headSha);

      if (status.state === "success" || status.state === "failure") return "SETTLED";

      if (now() + CI_POLL_INTERVAL_MS >= budgetEndsAt) return "TIMED_OUT";

      await wait(CI_POLL_INTERVAL_MS);
    }
  } catch (error) {
    // Bewust stoppen in plaats van doorgaan: zie de toelichting bovenaan.
    console.error("Wachten op de CI-stand mislukt; de missie wacht tot de volgende tik.", error);
    return "ERROR";
  }
}
