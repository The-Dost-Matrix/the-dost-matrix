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
