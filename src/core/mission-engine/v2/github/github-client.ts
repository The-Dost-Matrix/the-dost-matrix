/**
 * Minimale GitHub REST API-client voor de Builder-rol van Mission Engine V2.
 *
 * Bewust zonder extra afhankelijkheid (geen @octokit/rest): dit gebruikt de
 * ingebouwde `fetch` en alleen de paar endpoints die de Builder nodig heeft
 * om een branch aan te maken, bestanden te schrijven en een pull request te
 * openen.
 *
 * Dit is de concrete invulling van de architectuurbeslissing dat agents
 * projectcode aanpassen via GitHub (een branch + pull request die de
 * eigenaar zelf beoordeelt en merget), en nooit door rechtstreeks bestanden
 * op de pc van de eigenaar aan te raken — zie [[the-dost-matrix]] in het
 * Second Brain. Er wordt hier dan ook nooit rechtstreeks naar de
 * standaardbranch (bv. "main") geschreven.
 */

export interface GithubRepoTarget {
  owner: string;
  repo: string;
}

const GITHUB_API_ROOT = "https://api.github.com";

export class GithubApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
  }
}

function getToken(): string {
  const token = process.env.GITHUB_BUILDER_TOKEN;

  if (!token) {
    throw new Error(
      "GITHUB_BUILDER_TOKEN ontbreekt. Zonder deze sleutel kan de Builder-rol geen branch of pull request aanmaken op GitHub.",
    );
  }

  return token;
}

/**
 * Bepaalt welke repository de Builder-rol mag aanpassen. Standaard de
 * hoofdrepository van The Dost Matrix zelf; via omgevingsvariabelen te
 * overschrijven zodra een missie een andere repository (bv. een
 * projectrepository zoals dost-industries-app) moet aanpassen.
 */
export function getGithubRepoTarget(): GithubRepoTarget {
  const owner = process.env.GITHUB_BUILDER_REPO_OWNER?.trim() || "The-Dost-Matrix";
  const repo = process.env.GITHUB_BUILDER_REPO_NAME?.trim() || "the-dost-matrix";

  return { owner, repo };
}

/** Codeert elk pad-segment apart, zodat slashes in bestandspaden behouden blijven. */
function encodeRepoPath(filePath: string): string {
  return filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function githubRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();

  const response = await fetch(`${GITHUB_API_ROOT}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    let message = bodyText;

    try {
      const parsed = JSON.parse(bodyText) as { message?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      // Geen JSON-body — de ruwe tekst blijft staan als foutmelding.
    }

    throw new GithubApiError(
      response.status,
      `GitHub-aanvraag mislukt (${response.status} ${path}): ${message || response.statusText}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function getDefaultBranch(target: GithubRepoTarget): Promise<string> {
  const data = await githubRequest<{ default_branch: string }>(
    `/repos/${target.owner}/${target.repo}`,
  );

  return data.default_branch;
}

export async function getBranchHeadSha(target: GithubRepoTarget, branch: string): Promise<string> {
  const data = await githubRequest<{ object: { sha: string } }>(
    `/repos/${target.owner}/${target.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
  );

  return data.object.sha;
}

export async function createBranch(
  target: GithubRepoTarget,
  newBranch: string,
  fromSha: string,
): Promise<void> {
  await githubRequest(`/repos/${target.owner}/${target.repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
  });
}

export interface RepoTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
}

/**
 * Haalt de volledige bestandsboom van een branch op. `ref` mag een
 * branchnaam zijn (zoals de standaardbranch) — GitHub accepteert dat voor
 * dit endpoint net zo goed als een commit-SHA.
 */
export async function getRepoTree(target: GithubRepoTarget, ref: string): Promise<RepoTreeEntry[]> {
  const data = await githubRequest<{ tree: RepoTreeEntry[]; truncated: boolean }>(
    `/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );

  return data.tree;
}

export interface GithubFileContent {
  content: string;
  sha: string;
}

/** Geeft `null` terug wanneer het bestand nog niet bestaat (nieuw bestand). */
export async function getFileContent(
  target: GithubRepoTarget,
  filePath: string,
  ref: string,
): Promise<GithubFileContent | null> {
  try {
    const data = await githubRequest<{ content: string; encoding: string; sha: string }>(
      `/repos/${target.owner}/${target.repo}/contents/${encodeRepoPath(filePath)}?ref=${encodeURIComponent(ref)}`,
    );

    if (data.encoding !== "base64") {
      throw new Error(`Onverwachte encoding voor ${filePath}: ${data.encoding}`);
    }

    return {
      content: Buffer.from(data.content, "base64").toString("utf-8"),
      sha: data.sha,
    };
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export interface UpsertFileInput {
  path: string;
  content: string;
  message: string;
  branch: string;
  /** Verplicht wanneer een bestaand bestand wordt overschreven; weglaten voor een nieuw bestand. */
  sha?: string;
}

export async function upsertFile(target: GithubRepoTarget, input: UpsertFileInput): Promise<void> {
  await githubRequest(`/repos/${target.owner}/${target.repo}/contents/${encodeRepoPath(input.path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message: input.message,
      content: Buffer.from(input.content, "utf-8").toString("base64"),
      branch: input.branch,
      ...(input.sha ? { sha: input.sha } : {}),
    }),
  });
}

export interface CreatePullRequestInput {
  title: string;
  head: string;
  base: string;
  body: string;
}

export interface CreatePullRequestResult {
  url: string;
  number: number;
}

export async function createPullRequest(
  target: GithubRepoTarget,
  input: CreatePullRequestInput,
): Promise<CreatePullRequestResult> {
  const data = await githubRequest<{ html_url: string; number: number }>(
    `/repos/${target.owner}/${target.repo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );

  return { url: data.html_url, number: data.number };
}

export interface PullRequestSummary {
  number: number;
  headRef: string;
  /**
   * De exacte commit-SHA van de laatste stand van de PR-branch. Gebruikt
   * (in plaats van de branchnaam) als `ref` bij het ophalen van
   * bestandsinhoud voor QA — zie qa-runtime.ts. Een SHA blijft geldig ook
   * nadat een branch na het mergen is verwijderd (de commit blijft bestaan
   * als voorouder van de merge-commit), en verandert nooit onder je vandaan
   * terwijl QA bezig is, in tegenstelling tot een branchnaam die door een
   * nieuwe push kan verschuiven.
   */
  headSha: string;
  merged: boolean;
  state: string;
  url: string;
  title: string;
}

/**
 * Haalt pull requests op, meest recente eerst. Gebruikt door de QA-rol om de
 * pull request te vinden die bij een missie hoort (via de branchnaam die de
 * Builder-rol aanmaakt, zie builder-runtime.ts) en om te bepalen of die al
 * gemerged is. `merged_at` (niet `merged`) zit al in de lijst-respons, dus
 * hier is geen aparte aanvraag per pull request nodig.
 */
export async function listPullRequests(
  target: GithubRepoTarget,
  state: "open" | "closed" | "all" = "all",
): Promise<PullRequestSummary[]> {
  const data = await githubRequest<
    {
      number: number;
      head: { ref: string; sha: string };
      merged_at: string | null;
      state: string;
      html_url: string;
      title: string;
    }[]
  >(
    `/repos/${target.owner}/${target.repo}/pulls?state=${state}&per_page=100&sort=created&direction=desc`,
  );

  return data.map((pr) => ({
    number: pr.number,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    merged: pr.merged_at !== null,
    state: pr.state,
    url: pr.html_url,
    title: pr.title,
  }));
}

export interface BranchComparison {
  status: "identical" | "ahead" | "behind" | "diverged";
  /** Aantal commits dat `base` heeft en dat NIET in `head` zit. */
  behindBy: number;
  /** Aantal commits dat `head` heeft en dat NIET in `base` zit. */
  aheadBy: number;
}

/**
 * Vergelijkt `head` (bijvoorbeeld een PR-branch) ten opzichte van `base`
 * (bijvoorbeeld de standaardbranch). `behindBy > 0` betekent dat er op
 * `base` inmiddels commits staan die niet in `head` zitten — dus dat `head`
 * niet meer de meest actuele stand van `base` bevat.
 *
 * Gebruikt door de QA-rol (zie qa-runtime.ts) als veiligheidscontrole vóórdat
 * ze een PR-branch als bewijsmateriaal gebruikt: zonder deze controle zou QA
 * een oordeel kunnen geven op basis van een branch die "vergeten" is bij te
 * werken nadat er ondertussen iets anders op de standaardbranch is gemerged
 * — hetzelfde soort onvolledige-bewijs-probleem als de oorspronkelijke
 * diff-only bug, nu vanuit de andere richting.
 */
export async function compareBranches(
  target: GithubRepoTarget,
  base: string,
  head: string,
): Promise<BranchComparison> {
  const data = await githubRequest<{
    status: "identical" | "ahead" | "behind" | "diverged";
    ahead_by: number;
    behind_by: number;
  }>(
    `/repos/${target.owner}/${target.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
  );

  return { status: data.status, behindBy: data.behind_by, aheadBy: data.ahead_by };
}

export interface MergePullRequestInput {
  /** Standaard "merge" (een gewone merge-commit) — expliciet zo gekozen door de eigenaar. */
  mergeMethod?: "merge" | "squash" | "rebase";
  commitTitle?: string;
  commitMessage?: string;
}

export interface MergePullRequestResult {
  merged: boolean;
  sha: string;
  message: string;
}

/**
 * Merget een pull request op GitHub — dezelfde actie als de groene "Merge
 * pull request"-knop op GitHub.com, nu uitgevoerd via de API.
 *
 * Gebruikt door de Director (zie director-runtime.ts) om, uitsluitend
 * wanneer de qa-rol een pull request al volledig heeft goedgekeurd (alle
 * succescriteria PASSED), de missie in één stap te mergen én af te ronden —
 * dit is een expliciete, bewuste keuze van de eigenaar (ná de pre-merge
 * QA-wijziging) om niet langer zelf op GitHub te hoeven klikken voor dit
 * soort al-goedgekeurd werk. Dit blijft een gewone GitHub-merge van een
 * bestaande, door de eigenaar zichtbare pull request — er wordt nooit
 * rechtstreeks naar de standaardbranch geschreven buiten deze pull-request-
 * flow om.
 *
 * Gooit een `GithubApiError` wanneer de pull request niet gemergd kan
 * worden (bijvoorbeeld een mergeconflict, of de PR is inmiddels gesloten
 * zonder te mergen) — de aanroeper (director-runtime.ts) vertaalt dat naar
 * een duidelijke melding voor de eigenaar in plaats van de missie alsnog als
 * voltooid te markeren.
 */
export async function mergePullRequest(
  target: GithubRepoTarget,
  pullNumber: number,
  input: MergePullRequestInput = {},
): Promise<MergePullRequestResult> {
  const data = await githubRequest<{ merged: boolean; sha: string; message: string }>(
    `/repos/${target.owner}/${target.repo}/pulls/${pullNumber}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({
        merge_method: input.mergeMethod ?? "merge",
        ...(input.commitTitle ? { commit_title: input.commitTitle } : {}),
        ...(input.commitMessage ? { commit_message: input.commitMessage } : {}),
      }),
    },
  );

  return { merged: data.merged, sha: data.sha, message: data.message };
}

export interface CombinedCheckStatus {
  /**
   * "success": alle checks zijn afgerond en geslaagd (of er zijn er geen —
   * zie "none"). "failure": minstens één check is afgerond met een
   * niet-geslaagde uitkomst. "pending": minstens één check loopt nog.
   * "none": er zijn helemaal geen check-runs geregistreerd voor deze commit
   * (bijvoorbeeld een repository zonder CI-workflow) — dit telt bewust NIET
   * als "failure", anders zou elke missie in zo'n repository nooit meer
   * kunnen afronden of mergen.
   */
  state: "success" | "failure" | "pending" | "none";
  /** Namen van checks die zijn afgerond met een niet-geslaagde uitkomst. */
  failingCheckNames: string[];
  /** Namen van checks die nog niet zijn afgerond. */
  pendingCheckNames: string[];
}

/**
 * Haalt de GitHub Actions check-runs op voor een specifieke commit (in de
 * praktijk `pr.headSha`, zie `PullRequestSummary`) en vat ze samen tot één
 * simpel oordeel.
 *
 * Gebouwd na een live misser: QA (zie qa-runtime.ts) beoordeelde een pull
 * request met een falende CI-check (drie verzonnen, niet-bestaande imports —
 * "CI / Typecheck & import-check" faalde) toch op alle succescriteria als
 * GEHAALD, omdat de LLM de importfout niet zelf als blokkerend gebrek
 * herkende. Of code daadwerkelijk compileert/importeert is objectief
 * verifieerbaar en hoort dus niet af te hangen van of een LLM dat toevallig
 * doorheeft — vandaar deze mechanische, niet-LLM-afhankelijke controle, die
 * zowel qa-runtime.ts (vóór GEHAALD) als director-runtime.ts (vóór mergen)
 * gebruiken.
 *
 * Gebruikt de Checks-API (`/commits/{ref}/check-runs`), niet de oudere
 * Statuses-API: de CI van dit project draait als GitHub Actions-workflow, en
 * die registreert zichzelf als check-run, niet als losse "status".
 *
 * Bekende, bewuste beperking: GitHub staat de "Checks"-permissie (nodig voor
 * dit endpoint) momenteel NIET toe op fine-grained personal access tokens —
 * dit is een limitatie van GitHub zelf, bevestigd door GitHub Support ("only
 * GitHub Apps can access this API"), niet iets dat via tokeninstellingen op
 * te lossen is met het huidige `GITHUB_BUILDER_TOKEN`. De eigenaar heeft
 * ervoor gekozen dit voorlopig NIET op te lossen (bijvoorbeeld via een
 * classic token of een GitHub App, beide met hun eigen nadelen — zie
 * README.md) en dit later als apart punt op te pakken. Om die reden vangt
 * deze functie een 403 op dit endpoint expliciet af en behandelt dat als
 * "none" (geen bekende CI-status) in plaats van de aanroeper te laten
 * crashen — zonder deze vangnet zou ELKE QA- of Director-stap onherroepelijk
 * stuklopen zolang het token deze permissie mist. Zodra het token ooit wél
 * Checks-toegang krijgt, werkt de CI-gate in qa-runtime.ts/director-
 * runtime.ts automatisch, zonder verdere codewijziging.
 */
export async function getCombinedCheckStatus(
  target: GithubRepoTarget,
  ref: string,
): Promise<CombinedCheckStatus> {
  let data: { total_count: number; check_runs: { name: string; status: string; conclusion: string | null }[] };

  try {
    data = await githubRequest(
      `/repos/${target.owner}/${target.repo}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`,
    );
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 403) {
      return { state: "none", failingCheckNames: [], pendingCheckNames: [] };
    }
    throw error;
  }

  if (data.total_count === 0) {
    return { state: "none", failingCheckNames: [], pendingCheckNames: [] };
  }

  const nonSuccessConclusions = new Set([
    "failure",
    "timed_out",
    "cancelled",
    "action_required",
    "stale",
  ]);

  const failingCheckNames = data.check_runs
    .filter(
      (run) =>
        run.status === "completed" && run.conclusion !== null && nonSuccessConclusions.has(run.conclusion),
    )
    .map((run) => run.name);

  const pendingCheckNames = data.check_runs
    .filter((run) => run.status !== "completed")
    .map((run) => run.name);

  if (failingCheckNames.length > 0) {
    return { state: "failure", failingCheckNames, pendingCheckNames };
  }

  if (pendingCheckNames.length > 0) {
    return { state: "pending", failingCheckNames: [], pendingCheckNames };
  }

  return { state: "success", failingCheckNames: [], pendingCheckNames: [] };
}

export interface PullRequestFileChange {
  filename: string;
  status: string;
  patch?: string;
}

/** Geeft de gewijzigde bestanden (met diff/patch waar beschikbaar) van een pull request. */
export async function getPullRequestFiles(
  target: GithubRepoTarget,
  pullNumber: number,
): Promise<PullRequestFileChange[]> {
  const data = await githubRequest<
    { filename: string; status: string; patch?: string }[]
  >(`/repos/${target.owner}/${target.repo}/pulls/${pullNumber}/files?per_page=100`);

  return data.map((file) => ({
    filename: file.filename,
    status: file.status,
    patch: file.patch,
  }));
}
