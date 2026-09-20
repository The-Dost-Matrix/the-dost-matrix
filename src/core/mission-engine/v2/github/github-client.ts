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
 *
 * Authenticatie gebeurt als GitHub App-installatie (niet meer als
 * statisch personal access token): deze module ondertekent zelf een
 * kortlevende App-JWT (RS256, via Node's ingebouwde `crypto`-module) en
 * wisselt die in voor een installation access token. Dat token is precies
 * de reden dat de Checks-API (zie `getCombinedCheckStatus`) hier wél
 * toegankelijk is — een permissie die fine-grained personal access tokens
 * nooit konden krijgen.
 */

import { sign as cryptoSign } from "node:crypto";

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

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} ontbreekt. Zonder deze omgevingsvariabele kan de Builder-rol niet authenticeren als GitHub App-installatie.`,
    );
  }

  return value;
}

/**
 * GitHub App-private keys komen via omgevingsvariabelen vaak binnen met
 * letterlijke `\n`-tekens in plaats van echte regeleindes (afhankelijk van
 * hoe de omgeving multiline-waarden opslaat). Deze functie normaliseert
 * beide varianten naar een geldige PEM-string, zodat de sleutel hoe dan ook
 * gebruikt kan worden om te ondertekenen.
 */
function normalizePrivateKey(rawPrivateKey: string): string {
  return rawPrivateKey.includes("\\n") ? rawPrivateKey.replace(/\\n/g, "\n") : rawPrivateKey;
}

function base64UrlEncode(input: string | Buffer): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Ondertekent een kortlevende GitHub App-JWT (RS256) met Node's ingebouwde
 * `crypto`-module — geen nieuwe afhankelijkheid nodig. `iat` wordt 60
 * seconden in het verleden gezet (GitHub's aanbevolen marge tegen
 * kloksynchronisatie-afwijkingen tussen deze machine en GitHub's servers)
 * en `exp` blijft ruim binnen de door GitHub toegestane 10 minuten.
 */
export function createAppJwt(appId: string, privateKeyPem: string): string {
  const nowInSeconds = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: nowInSeconds - 60,
    exp: nowInSeconds + 8 * 60,
    iss: appId,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = cryptoSign("RSA-SHA256", Buffer.from(signingInput, "utf-8"), privateKeyPem);

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

interface CachedInstallationToken {
  token: string;
  /** Epoch-milliseconden waarop het token verloopt (uit GitHub's `expires_at`). */
  expiresAtMs: number;
}

/** Hoe ruim vóór het daadwerkelijke verlopen het token alvast ververst wordt. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

let cachedInstallationToken: CachedInstallationToken | null = null;

/** Uitsluitend voor tests: dwingt een nieuwe tokenuitwisseling af bij de volgende aanroep. */
export function resetInstallationTokenCacheForTests(): void {
  cachedInstallationToken = null;
}

async function exchangeJwtForInstallationToken(): Promise<CachedInstallationToken> {
  const appId = getRequiredEnv("GITHUB_APP_ID");
  const installationId = getRequiredEnv("GITHUB_APP_INSTALLATION_ID");
  const privateKey = normalizePrivateKey(getRequiredEnv("GITHUB_APP_PRIVATE_KEY"));

  const jwt = createAppJwt(appId, privateKey);

  const response = await fetch(
    `${GITHUB_API_ROOT}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

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
      `Kon geen GitHub App installation token verkrijgen (${response.status}): ${message || response.statusText}`,
    );
  }

  const data = (await response.json()) as { token: string; expires_at: string };

  return { token: data.token, expiresAtMs: new Date(data.expires_at).getTime() };
}

/**
 * Geeft een geldig installation access token terug voor de Builder-rol,
 * geauthenticeerd als GitHub App-installatie (via `GITHUB_APP_ID`,
 * `GITHUB_APP_INSTALLATION_ID` en `GITHUB_APP_PRIVATE_KEY`).
 *
 * Het opgehaalde token (1 uur geldig) wordt in-memory gecachet en pas kort
 * vóór het verlopen automatisch ververst — niet bij elke aanroep opnieuw
 * opgehaald, om onnodige aanvragen naar GitHub's token-endpoint te
 * vermijden.
 */
export async function getToken(): Promise<string> {
  const now = Date.now();

  if (cachedInstallationToken && cachedInstallationToken.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > now) {
    return cachedInstallationToken.token;
  }

  cachedInstallationToken = await exchangeJwtForInstallationToken();
  return cachedInstallationToken.token;
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
  const token = await getToken();

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

/**
 * Zelfde als githubRequest, maar voor endpoints die platte tekst teruggeven
 * in plaats van JSON — in de praktijk alleen het logboek van een
 * Actions-taak. Dat endpoint antwoordt met een omleiding naar een tijdelijke
 * URL; `fetch` volgt die standaard, dus daar hoeft hier niets extra's voor
 * te gebeuren.
 */
async function githubRequestText(path: string): Promise<string> {
  const token = await getToken();

  const response = await fetch(`${GITHUB_API_ROOT}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new GithubApiError(
      response.status,
      `GitHub-aanvraag mislukt (${response.status} ${path}): ${bodyText || response.statusText}`,
    );
  }

  return response.text();
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
  /**
   * Wanneer de pull request is aangemaakt, als ISO-tekst. Optioneel omdat
   * bestaande testdubbels dit veld niet vullen; gebruikt door de Director-chat
   * om te laten zien hoe lang een pull request al openstaat (project-state.ts).
   */
  createdAt?: string;
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
      created_at?: string;
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
    // Voorwaardelijk, zodat het veld afwezig blijft in plaats van undefined:
    // dezelfde reden als bij `kind` in engine.ts — Firestore en strikte
    // vergelijkingen gaan anders alsnog over een undefined struikelen.
    ...(pr.created_at ? { createdAt: pr.created_at } : {}),
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
   * "success": alle checks zijn afgerond en geslaagd. "failure": minstens
   * één check is afgerond met een niet-geslaagde uitkomst. "pending":
   * minstens één check loopt nog. "none": er zijn helemaal geen check-runs
   * geregistreerd voor deze commit (bijvoorbeeld een repository zonder
   * CI-workflow, of de eerste seconden na een push). "unknown": GitHub gaf
   * de stand niet prijs — in de praktijk een HTTP 403 op de Checks-API.
   *
   * WAAROM "unknown" SINDS 20 SEPTEMBER 2026 APART STAAT
   *
   * Tot die datum werd een 403 vertaald naar "none", met hier de toelichting
   * dat "none" bewust niet als "failure" telt omdat een repository zonder CI
   * anders nooit meer zou kunnen mergen. Die redenering klopte voor een
   * repository zonder CI, maar ze zette twee heel verschillende situaties op
   * één hoop: "er is hier niets te controleren" en "ik mag of kan niet zien
   * wat de controle zegt". Externe review (F-02, 20 september 2026) wees daar
   * terecht op: het tweede is geen positieve verificatie.
   *
   * Beide blijven op zichzelf géén "failure" — er is niets gefaald. Of ze een
   * automatische merge mogen tegenhouden is een beleidsvraag, en die staat in
   * ci-policy.ts, niet hier.
   */
  state: "success" | "failure" | "pending" | "none" | "unknown";
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
 * Voorheen kon dit endpoint niet werken: GitHub staat de "Checks"-permissie
 * (nodig voor dit endpoint) niet toe op fine-grained personal access
 * tokens — een limitatie van GitHub zelf, bevestigd door GitHub Support
 * ("only GitHub Apps can access this API"). Die beperking is met deze
 * wijziging opgelost: deze client authenticeert nu als GitHub
 * App-installatie (zie `getToken`), en die installatie kan wél met de
 * Checks-permissie geautoriseerd worden. De 403-afvangst hieronder blijft
 * bestaan als defensief vangnet (bijvoorbeeld wanneer de installatie zelf
 * per ongeluk zonder Checks-permissie is aangemaakt) en behandelt zo'n geval
 * als "none" (geen bekende CI-status) in plaats van de aanroeper te laten
 * crashen.
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
      // Niet "none": we weten niet of er checks zijn, laat staan wat ze
      // zeggen. Zie de toelichting bij CombinedCheckStatus.state.
      return { state: "unknown", failingCheckNames: [], pendingCheckNames: [] };
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
/**
 * Eén gefaalde check-run, met alles wat nodig is om de échte foutmelding op
 * te sporen. Toegevoegd voor roadmapstap 11: tot dan wist de app alleen de
 * NAAM van een gefaalde controle (zie `CombinedCheckStatus.failingCheckNames`),
 * en daar valt niets mee te repareren.
 */
export interface FailingCheckRun {
  name: string;
  checkRunId: number;
  /** URL naar de taak op github.com; hieruit volgt het taaknummer. */
  detailsUrl: string | null;
  outputTitle: string | null;
  outputSummary: string | null;
}

/**
 * Haalt de gefaalde check-runs voor een commit op, mét hun identificatie en
 * eigen uitvoer. Bewust naast `getCombinedCheckStatus` in plaats van erin:
 * die functie beantwoordt de vraag "mag ik mergen?" en wordt op elke
 * Director-stap aangeroepen; deze beantwoordt "wat ging er precies mis?" en
 * hoeft alleen bij rood te draaien.
 *
 * Net als daar telt een 403 als "geen informatie" in plaats van een fout:
 * een ontbrekende permissie mag een missie nooit laten crashen.
 */
export async function getFailingCheckRuns(
  target: GithubRepoTarget,
  ref: string,
): Promise<FailingCheckRun[]> {
  let data: {
    total_count: number;
    check_runs: {
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
      details_url: string | null;
      output?: { title?: string | null; summary?: string | null } | null;
    }[];
  };

  try {
    data = await githubRequest(
      `/repos/${target.owner}/${target.repo}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`,
    );
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 403) return [];
    throw error;
  }

  const nonSuccessConclusions = new Set([
    "failure",
    "timed_out",
    "cancelled",
    "action_required",
    "stale",
  ]);

  return data.check_runs
    .filter(
      (run) =>
        run.status === "completed" &&
        run.conclusion !== null &&
        nonSuccessConclusions.has(run.conclusion),
    )
    .map((run) => ({
      name: run.name,
      checkRunId: run.id,
      detailsUrl: run.details_url ?? null,
      outputTitle: run.output?.title ?? null,
      outputSummary: run.output?.summary ?? null,
    }));
}

/** Een door GitHub aangewezen plek in de code waar een controle op stukliep. */
export interface CheckRunAnnotation {
  path: string;
  startLine: number | null;
  level: string;
  message: string;
}

/**
 * Annotaties van een check-run: bestand, regelnummer en melding.
 *
 * Let op: GitHub Actions maakt deze alleen aan wanneer een stap ze expliciet
 * uitstuurt (via de `::error file=...`-notatie). `tsc` en `vitest` doen dat
 * van zichzelf niet, dus voor dit project zal deze lijst vaak leeg zijn — het
 * logboek hieronder is dan de bron. Bewust toch opgehaald: als de lijst er
 * wél is, is hij preciezer dan welke logregel ook.
 */
export async function getCheckRunAnnotations(
  target: GithubRepoTarget,
  checkRunId: number,
): Promise<CheckRunAnnotation[]> {
  try {
    const data = await githubRequest<
      {
        path: string;
        start_line: number | null;
        annotation_level: string | null;
        message: string | null;
      }[]
    >(
      `/repos/${target.owner}/${target.repo}/check-runs/${checkRunId}/annotations?per_page=50`,
    );

    return data.map((annotation) => ({
      path: annotation.path,
      startLine: annotation.start_line ?? null,
      level: annotation.annotation_level ?? "unknown",
      message: annotation.message ?? "",
    }));
  } catch (error) {
    if (error instanceof GithubApiError && (error.status === 403 || error.status === 404)) {
      return [];
    }
    throw error;
  }
}

/** Waarom het logboek van een taak niet kon worden opgehaald. */
export interface JobLogResult {
  log: string | null;
  unavailableReason: string | null;
}

/**
 * Het ruwe logboek van één Actions-taak.
 *
 * Dit endpoint vraagt de permissie **Actions: Read** op de GitHub App. Die
 * stond er bij het bouwen van stap 6 niet bij (toen waren Contents, Pull
 * requests en Checks genoeg). Ontbreekt hij, dan geeft GitHub een 403 en
 * geeft deze functie de reden terug in plaats van te crashen — het verslag
 * vermeldt dan expliciet dát het logboek mist, zodat niemand denkt dat de
 * foutmelding compleet is.
 */
export async function getJobLog(
  target: GithubRepoTarget,
  jobId: string,
): Promise<JobLogResult> {
  try {
    const log = await githubRequestText(
      `/repos/${target.owner}/${target.repo}/actions/jobs/${encodeURIComponent(jobId)}/logs`,
    );

    return { log, unavailableReason: null };
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 403) {
      return {
        log: null,
        unavailableReason:
          'de GitHub App heeft geen toegang tot Actions-logboeken (permissie "Actions: Read" ontbreekt of is nog niet goedgekeurd op de installatie)',
      };
    }

    if (error instanceof GithubApiError && error.status === 404) {
      return {
        log: null,
        unavailableReason: `GitHub kent taak ${jobId} niet (meer); logboeken worden na verloop van tijd opgeruimd`,
      };
    }

    if (error instanceof GithubApiError && error.status === 410) {
      return { log: null, unavailableReason: "het logboek is door GitHub verwijderd (verlopen)" };
    }

    throw error;
  }
}

/** Eén commit, teruggebracht tot wat er nodig is om ouderdom te bepalen. */
export interface CommitSummary {
  sha: string;
  committedAt: string;
}

/**
 * De laatste commit die een specifiek bestand raakte.
 *
 * Toegevoegd om te kunnen bepalen hóe oud docs/roadmap.md is ten opzichte van
 * de rest van het project: zonder dat zou de Director een met de hand
 * bijgehouden document als actuele waarheid presenteren, ook wanneer er
 * sindsdien tientallen commits zijn geland. Zie project-state.ts.
 */
export async function getLatestCommitForPath(
  target: GithubRepoTarget,
  filePath: string,
): Promise<CommitSummary | null> {
  try {
    const data = await githubRequest<
      { sha: string; commit: { committer?: { date?: string }; author?: { date?: string } } }[]
    >(
      `/repos/${target.owner}/${target.repo}/commits?path=${encodeURIComponent(filePath)}&per_page=1`,
    );

    const first = data[0];
    if (!first) return null;

    const committedAt = first.commit.committer?.date ?? first.commit.author?.date;
    if (!committedAt) return null;

    return { sha: first.sha, committedAt };
  } catch (error) {
    if (error instanceof GithubApiError && (error.status === 403 || error.status === 404)) {
      return null;
    }
    throw error;
  }
}

/**
 * Hoeveel commits er sinds een tijdstip op de standaardbranch zijn geland.
 *
 * Begrensd op honderd: het verschil tussen "vijf commits achter" en "meer dan
 * honderd commits achter" verandert niets aan de conclusie, en een exacte
 * telling zou pagineren betekenen bij elke chatbeurt.
 */
export async function countCommitsSince(
  target: GithubRepoTarget,
  sinceIso: string,
): Promise<{ count: number; capped: boolean }> {
  try {
    const data = await githubRequest<{ sha: string }[]>(
      `/repos/${target.owner}/${target.repo}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`,
    );

    // De commit op exact dat tijdstip is de wijziging zelf en telt niet mee.
    const count = Math.max(0, data.length - 1);
    return { count, capped: data.length >= 100 };
  } catch (error) {
    if (error instanceof GithubApiError && (error.status === 403 || error.status === 404)) {
      return { count: 0, capped: false };
    }
    throw error;
  }
}
