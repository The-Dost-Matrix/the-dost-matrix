import {
  getCombinedCheckStatus,
  getGithubRepoTarget,
  getPullRequestFiles,
  listPullRequests,
  type CombinedCheckStatus,
} from "./github/github-client";
import type { MissionAssignmentRecord, MissionV2 } from "./mission";
import { findMissionPullRequest } from "./qa-runtime";

/**
 * Stap 17 — Director Evidence Upgrade.
 *
 * Tot deze stap zag de Director van elke eerdere toewijzing precies drie
 * dingen: welke rol, welke status, en de opdrachttekst die hij er zélf ooit
 * aan had meegegeven. Niet wat die rol had opgeleverd, niet of er een pull
 * request uit was gekomen, niet of de CI daarop groen was. Hij besliste dus
 * over de volgende stap op grond van zijn eigen vorige opdracht plus een
 * statuswoord — en moest maar aannemen dat "COMPLETED" betekende dat er iets
 * bruikbaars was gebeurd.
 *
 * Dat is precies de bovengrens die de roadmap beschrijft: zolang de Builder
 * nog vaak faalde, was dit niet de knellendste beperking, maar zodra de
 * missielus op eigen benen staat, is het gebrek aan bewijs het eerste wat hem
 * dom houdt. Een Director die de uitkomst van de vorige stap niet kent, kan de
 * volgende stap alleen maar gokken.
 *
 * Dit bestand levert dat bewijs, met drie harde randvoorwaarden.
 *
 * **Compact, niet volledig.** De diff zelf gaat hier NIET in. Beoordelen of
 * de code klopt is het werk van de qa-rol en van de geautomatiseerde signoff;
 * de Director beslist alleen wat er nú moet gebeuren. Een volledige diff zou
 * die beslissing verdrinken én bij elke stap opnieuw betaald worden. Wat hij
 * krijgt is: welke bestanden geraakt zijn, wat de CI zegt, en de samenvatting
 * die de rol zelf al had achtergelaten.
 *
 * **Begrensd, niet meegroeiend.** Een missie die vastloopt in een herstellus
 * verzamelt toewijzingen. Zonder plafond zou de prompt bij elke ronde groeien,
 * en juist bij een vastgelopen missie zou hij dan het duurst worden. Daarom
 * alleen de meest recente toewijzingen, met een expliciete regel over hoeveel
 * er zijn weggelaten — de Director hoort te weten dat er meer geschiedenis is,
 * ook als hij hem niet ziet.
 *
 * **Gepind aan een commit.** De CI-status en de bestandslijst horen bij één
 * exacte commit (`headSha`), niet bij "de branch". Een branchnaam kan onder je
 * vandaan verschuiven door een nieuwe push; een SHA niet. Dezelfde redenering
 * als bij QA (zie `PullRequestSummary.headSha` in github-client.ts) en als het
 * gepinde bewijs dat stap 16 voor het Claim Ledger voorziet.
 *
 * En één gedragsregel: **een GitHub-storing mag nooit een missie stilzetten.**
 * Lukt het ophalen niet, dan gaat de Director verder met minder bewijs — niet
 * met een foutmelding. Dat is dezelfde afweging als bij budget (kosten
 * blokkeren nooit een missie) en bij `proposeMissionKnowledge` (fail-open):
 * extra context is winst, geen voorwaarde.
 */

/** Aantal meest recente toewijzingen dat de Director met bewijs te zien krijgt. */
const MAX_EVIDENCE_ASSIGNMENTS = 6;

/** Maximale lengte van één resultaatsamenvatting in de prompt. */
const MAX_RESULT_SUMMARY_CHARS = 400;

/** Maximale lengte van één opdrachttekst in de prompt. */
const MAX_OBJECTIVE_CHARS = 300;

/** Maximaal aantal gewijzigde bestanden dat bij naam wordt genoemd. */
const MAX_EVIDENCE_FILES = 12;

function truncate(value: string, maxChars: number): string {
  const trimmed = value.trim();

  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxChars)}… (${trimmed.length - maxChars} tekens ingekort)`;
}

export interface AssignmentEvidenceOptions {
  maxAssignments?: number;
  maxSummaryChars?: number;
}

/**
 * Zet de toewijzingsgeschiedenis om naar prompt-regels, inclusief wat elke
 * toewijzing daadwerkelijk heeft opgeleverd.
 *
 * `resultSummary` stond al op elke toewijzing (bewaard voor stap 12b, zodat
 * een weerwoord van de Builder zichtbaar bleef voor de eigenaar), maar werd
 * nooit aan de Director getoond. Dat is het goedkoopste deel van deze stap:
 * het bewijs lag er al, het werd alleen niet doorgegeven.
 *
 * `kind` telt net zo hard mee. Een toewijzing van soort TECHNICAL_REPAIR of
 * SEMANTIC_REPAIR betekent dat er al een herstelpoging is geweest. Zonder dat
 * onderscheid kan de Director een derde poging uitzetten die op precies
 * dezelfde manier is geformuleerd als de eerste twee.
 */
export function buildAssignmentEvidenceLines(
  assignments: MissionAssignmentRecord[],
  options: AssignmentEvidenceOptions = {},
): string {
  if (assignments.length === 0) {
    return "Nog geen eerdere toewijzingen.";
  }

  const maxAssignments = options.maxAssignments ?? MAX_EVIDENCE_ASSIGNMENTS;
  const maxSummaryChars = options.maxSummaryChars ?? MAX_RESULT_SUMMARY_CHARS;

  const omitted = Math.max(0, assignments.length - maxAssignments);
  const shown = assignments.slice(-maxAssignments);

  const lines = shown.map((assignment, index) => {
    // Doorgenummerd vanaf de positie in de VOLLEDIGE lijst, niet vanaf 1: de
    // Director moet kunnen zien dat toewijzing 7 de zevende is en niet de
    // eerste, ook wanneer de eerste zes zijn weggelaten.
    const position = omitted + index + 1;

    const head = [
      `${position}. rol=${assignment.roleId}`,
      assignment.kind ? `soort=${assignment.kind}` : null,
      `status=${assignment.status}`,
      `opdracht="${truncate(assignment.objective, MAX_OBJECTIVE_CHARS)}"`,
    ]
      .filter(Boolean)
      .join(", ");

    const summary = assignment.resultSummary?.trim();

    if (!summary) {
      // Expliciet benoemen in plaats van de regel weglaten. "Geen resultaat
      // vastgelegd" is zelf een signaal: bij een afgeronde toewijzing hoort
      // een samenvatting, en de afwezigheid ervan zegt iets over wat er is
      // misgegaan.
      return `${head}\n   resultaat: (geen samenvatting vastgelegd)`;
    }

    return `${head}\n   resultaat: ${truncate(summary, maxSummaryChars)}`;
  });

  if (omitted > 0) {
    lines.unshift(
      `(${omitted} oudere toewijzing${omitted === 1 ? "" : "en"} weggelaten; hieronder de ${shown.length} meest recente.)`,
    );
  }

  return lines.join("\n");
}

export interface PullRequestEvidence {
  number: number;
  title: string;
  url: string;
  state: string;
  merged: boolean;
  /** De commit waaraan de CI-status en de bestandslijst hieronder gepind zijn. */
  headSha: string;
  ci: CombinedCheckStatus;
  changedFiles: Array<{ filename: string; status: string }>;
  /** Aantal bestanden dat wegens de bovengrens niet bij naam is genoemd. */
  omittedFileCount: number;
}

/**
 * Haalt de pull request van deze missie op met zijn CI-status en gewijzigde
 * bestanden — of null wanneer er nog geen is, of wanneer GitHub niet bereikbaar
 * is.
 *
 * Doet bewust geen enkele aanvraag zolang er nog geen toewijzing is geweest:
 * vóór de eerste builder-toewijzing kan er per definitie geen pull request
 * bestaan, en een missie hoort niet drie GitHub-aanroepen te kosten om te
 * ontdekken dat er niets is.
 *
 * Haalt de diff (`patch`) bewust niet op uit `getPullRequestFiles`: alleen de
 * bestandsnamen en hun status worden gebruikt. Zie de toelichting bovenaan dit
 * bestand over waarom de Director geen diff krijgt.
 */
export async function gatherPullRequestEvidence(
  mission: MissionV2,
): Promise<PullRequestEvidence | null> {
  if (mission.assignments.length === 0) {
    return null;
  }

  try {
    const target = getGithubRepoTarget();
    const pullRequests = await listPullRequests(target, "all");
    const pullRequest = findMissionPullRequest(pullRequests, mission.missionId);

    if (!pullRequest) {
      return null;
    }

    const [ci, files] = await Promise.all([
      getCombinedCheckStatus(target, pullRequest.headSha),
      getPullRequestFiles(target, pullRequest.number),
    ]);

    return {
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      state: pullRequest.state,
      merged: pullRequest.merged,
      headSha: pullRequest.headSha,
      ci,
      changedFiles: files.slice(0, MAX_EVIDENCE_FILES).map((file) => ({
        filename: file.filename,
        status: file.status,
      })),
      omittedFileCount: Math.max(0, files.length - MAX_EVIDENCE_FILES),
    };
  } catch (error) {
    // Fail-open: geen bewijs is vervelend, een gestrande missie is erger. Wel
    // loggen, want als dit structureel misgaat beslist de Director stilletjes
    // blind en is dat nergens anders te zien.
    console.error("Bewijs van de pull request ophalen is mislukt", {
      missionId: mission.missionId,
      error: error instanceof Error ? error.message : error,
    });

    return null;
  }
}

function describeCi(ci: CombinedCheckStatus): string {
  switch (ci.state) {
    case "success":
      return "CI: geslaagd.";
    case "failure":
      return `CI: GEFAALD (${ci.failingCheckNames.join(", ") || "onbekende check"}).`;
    case "pending":
      return `CI: loopt nog (${ci.pendingCheckNames.join(", ") || "onbekende check"}).`;
    case "none":
    default:
      return "CI: geen checks geregistreerd voor deze commit.";
  }
}

/**
 * Formatteert het opgehaalde bewijs tot één promptblok. Apart gehouden van het
 * ophalen zodat het zonder netwerk getest kan worden — en zodat de tekst die
 * het model leest één plek heeft waar hij te lezen valt.
 */
export function formatPullRequestEvidence(
  evidence: PullRequestEvidence | null,
): string {
  if (!evidence) {
    return "Nog geen pull request gevonden voor deze missie (of GitHub was niet bereikbaar).";
  }

  const fileLines = evidence.changedFiles.map(
    (file) => `- ${file.filename} (${file.status})`,
  );

  if (evidence.omittedFileCount > 0) {
    fileLines.push(
      `- … en nog ${evidence.omittedFileCount} bestand${evidence.omittedFileCount === 1 ? "" : "en"}.`,
    );
  }

  return [
    `Pull request #${evidence.number}: "${evidence.title}"`,
    `Status: ${evidence.merged ? "GEMERGED" : evidence.state.toUpperCase()} — ${evidence.url}`,
    `${describeCi(evidence.ci)} (gepind aan commit ${evidence.headSha.slice(0, 7)})`,
    evidence.changedFiles.length > 0
      ? `Gewijzigde bestanden:\n${fileLines.join("\n")}`
      : "Gewijzigde bestanden: geen gevonden.",
  ].join("\n");
}
