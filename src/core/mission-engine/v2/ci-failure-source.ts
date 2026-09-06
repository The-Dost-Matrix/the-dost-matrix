import {
  getCheckRunAnnotations,
  getFailingCheckRuns,
  getJobLog,
  type GithubRepoTarget,
} from "./github/github-client";
import {
  extractJobIdFromDetailsUrl,
  formatCiFailureReport,
  type CiFailureInput,
} from "./ci-failure-report";

/**
 * Haalt bij GitHub op wat er precies is misgegaan bij een rode CI, en levert
 * dat als één leesbaar verslag op.
 *
 * Dit is de dunne laag tussen twee modules die bewust gescheiden blijven:
 * github-client.ts doet uitsluitend netwerkwerk, ci-failure-report.ts neemt
 * uitsluitend beslissingen en is daardoor zonder GitHub te testen. Dezelfde
 * scheiding als bij context-resolver.ts en resolveTestContext() in stap 10 —
 * die opzet maakte het verschil tussen "we denken dat het werkt" en "we
 * hebben het aantoonbaar getest".
 *
 * Hier zit daarom bewust geen enkele beslissing in: alleen ophalen,
 * doorgeven, en teruggeven.
 */

/**
 * Hoeveel gefaalde controles er maximaal worden uitgezocht. Elke controle
 * kost twee extra GitHub-aanroepen (annotaties en logboek), en in de praktijk
 * draait dit project één CI-taak. Meer dan drie zou vooral wachttijd
 * opleveren zonder dat het verslag beter wordt.
 */
export const MAX_INSPECTED_FAILING_CHECKS = 3;

export async function collectCiFailureReport(
  target: GithubRepoTarget,
  ref: string,
): Promise<string | null> {
  const failingChecks = await getFailingCheckRuns(target, ref);

  if (failingChecks.length === 0) return null;

  const inputs: CiFailureInput[] = [];

  for (const check of failingChecks.slice(0, MAX_INSPECTED_FAILING_CHECKS)) {
    const annotations = await getCheckRunAnnotations(target, check.checkRunId);
    const jobId = extractJobIdFromDetailsUrl(check.detailsUrl);

    const jobLog = jobId
      ? await getJobLog(target, jobId)
      : {
          log: null,
          unavailableReason:
            "GitHub gaf voor deze controle geen verwijzing naar een Actions-taak, dus er is geen logboek om op te halen",
        };

    inputs.push({
      checkName: check.name,
      outputTitle: check.outputTitle,
      outputSummary: check.outputSummary,
      annotations,
      jobLog: jobLog.log,
      jobLogUnavailableReason: jobLog.unavailableReason,
    });
  }

  return formatCiFailureReport(inputs);
}
