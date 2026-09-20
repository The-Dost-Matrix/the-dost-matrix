/**
 * Tests voor github-client.ts
 *
 * Deze tests controleren de hogere-niveau GitHub REST-operaties (branches,
 * bestanden, pull requests, mergen en de gecombineerde check-status) die
 * Mission Engine V2 gebruikt. Alle netwerktoegang is gemockt; nergens in dit
 * bestand wordt een echte GitHub App-sleutel, App ID of Installation ID
 * gebruikt — alleen verzonnen, lokaal gegenereerde testwaarden.
 *
 * De GitHub App-authenticatiestroom zelf (JWT-ondertekening, tokenuitwisseling
 * en cache/verversingsgedrag) wordt uitgebreid getest in
 * `github-app-auth.test.ts`. Hier wordt alleen gecontroleerd dat:
 *  - de client niet langer van `GITHUB_BUILDER_TOKEN` afhangt
 *  - elke REST-aanroep geauthenticeerd wordt met het installation access token
 *  - het installation-token één keer wordt opgehaald en daarna hergebruikt
 *  - bestaande branch/PR/merge/bestand-functionaliteit ongewijzigd blijft werken
 *  - `getCombinedCheckStatus` de Checks-API kan bereiken, wat met een
 *    fine-grained personal access token niet mogelijk was
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

// Een vers, wegwerpbaar RSA-sleutelpaar, puur voor deze testrun gegenereerd.
// Dit is GEEN echte GitHub App private key en wordt nooit bewaard of gelogd.
const { privateKey: TEST_PRIVATE_KEY } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

const TEST_APP_ID = "000000";
const TEST_INSTALLATION_ID = "111111";
const TEST_INSTALLATION_TOKEN = "ghs_fake_test_installation_token";
const TEST_TARGET = { owner: "dost-matrix", repo: "the-dost-matrix" };

const ORIGINAL_ENV = {
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_INSTALLATION_ID: process.env.GITHUB_APP_INSTALLATION_ID,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
  GITHUB_BUILDER_TOKEN: process.env.GITHUB_BUILDER_TOKEN,
};

function toResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function accessTokenResponse(token = TEST_INSTALLATION_TOKEN, expiresInSeconds = 3600) {
  return toResponse(
    { token, expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString() },
    201,
  );
}

/** Haalt de aanvraag-URL op als platte string, ongeacht hoe fetch is aangeroepen. */
function requestUrl(input: unknown): string {
  if (typeof input === "string") return input;
  const maybeToString = input as { toString(): string } | undefined;
  return maybeToString ? maybeToString.toString() : "";
}

/** Haalt de Authorization-header op uit een fetch-init-object, indien aanwezig. */
function authHeader(init: unknown): string | undefined {
  const headers = (init as { headers?: Record<string, string> } | undefined)?.headers;
  if (!headers) return undefined;
  return headers.Authorization ?? headers.authorization;
}

describe("github-client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env.GITHUB_APP_ID = TEST_APP_ID;
    process.env.GITHUB_APP_INSTALLATION_ID = TEST_INSTALLATION_ID;
    process.env.GITHUB_APP_PRIVATE_KEY = TEST_PRIVATE_KEY;
    delete process.env.GITHUB_BUILDER_TOKEN;

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.GITHUB_APP_ID = ORIGINAL_ENV.GITHUB_APP_ID;
    process.env.GITHUB_APP_INSTALLATION_ID = ORIGINAL_ENV.GITHUB_APP_INSTALLATION_ID;
    process.env.GITHUB_APP_PRIVATE_KEY = ORIGINAL_ENV.GITHUB_APP_PRIVATE_KEY;
    process.env.GITHUB_BUILDER_TOKEN = ORIGINAL_ENV.GITHUB_BUILDER_TOKEN;
  });

  async function loadClient() {
    return import("./github-client");
  }

  function tokenExchangeCalls() {
    return fetchMock.mock.calls.filter(([input]) =>
      requestUrl(input).includes(`/app/installations/${TEST_INSTALLATION_ID}/access_tokens`),
    );
  }

  it("leest of vereist GITHUB_BUILDER_TOKEN niet meer", async () => {
    expect(process.env.GITHUB_BUILDER_TOKEN).toBeUndefined();

    fetchMock.mockImplementation(async (input: unknown) => {
      if (requestUrl(input).includes("/access_tokens")) return accessTokenResponse();
      return toResponse({ ref: "refs/heads/feature/x" }, 201);
    });

    const client = await loadClient();
    await client.createBranch(TEST_TARGET, "feature/x", "base-sha-123");

    expect(tokenExchangeCalls()).toHaveLength(1);
  });

  describe("createBranch", () => {
    it("maakt een nieuwe ref aan, geauthenticeerd met het installation-token", async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.endsWith("/git/refs")) return toResponse({ ref: "refs/heads/feature/x" }, 201);
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();
      await client.createBranch(TEST_TARGET, "feature/x", "base-sha-123");

      const refsCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith("/git/refs"));
      expect(refsCall).toBeDefined();

      const [, init] = refsCall as [unknown, RequestInit];
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
      expect(init.method).toBe("POST");

      const body = JSON.parse(String(init.body));
      expect(body.ref).toBe("refs/heads/feature/x");
      expect(body.sha).toBe("base-sha-123");
    });

    it("geeft fouten door wanneer GitHub het aanmaken van de branch weigert", async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.endsWith("/git/refs")) return toResponse({ message: "Reference already exists" }, 422);
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();
      await expect(client.createBranch(TEST_TARGET, "feature/x", "base-sha-123")).rejects.toThrow();
    });
  });

  describe("getFileContent", () => {
    it("decodeert base64-bestandsinhoud die de contents-API teruggeeft", async () => {
      const rawContent = "export const answer = 42;\n";
      const encoded = Buffer.from(rawContent, "utf-8").toString("base64");

      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.includes("/contents/")) {
          return toResponse({ content: encoded, encoding: "base64", sha: "file-sha-456" });
        }
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();
      const file = await client.getFileContent(TEST_TARGET, "src/answer.ts", "feature/x");

      expect(file).toEqual({ content: rawContent, sha: "file-sha-456" });

      const contentsCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).includes("/contents/"));
      const [, init] = contentsCall as [unknown, RequestInit];
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
    });

    it("geeft null terug wanneer het bestand niet bestaat (404)", async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.includes("/contents/")) return toResponse({ message: "Not Found" }, 404);
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();
      const file = await client.getFileContent(TEST_TARGET, "src/missing.ts", "feature/x");

      expect(file).toBeNull();
    });
  });

  describe("upsertFile", () => {
    it("codeert de inhoud als base64 en geeft de sha mee bij het bijwerken", async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.includes("/contents/")) return toResponse({ commit: { sha: "commit-sha-789" } }, 200);
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();
      await client.upsertFile(TEST_TARGET, {
        path: "src/answer.ts",
        content: "export const answer = 43;\n",
        message: "chore: update answer",
        branch: "feature/x",
        sha: "file-sha-456",
      });

      const putCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).includes("/contents/"));
      const [, init] = putCall as [unknown, RequestInit];

      expect(init.method).toBe("PUT");
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);

      const body = JSON.parse(String(init.body));
      expect(body.sha).toBe("file-sha-456");
      expect(body.message).toBe("chore: update answer");
      expect(Buffer.from(body.content, "base64").toString("utf-8")).toBe("export const answer = 43;\n");
    });
  });

  describe("createPullRequest", () => {
    it("maakt een pull request aan en geeft het nummer en de URL terug", async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.endsWith("/pulls")) {
          return toResponse(
            { number: 42, html_url: "https://github.com/dost-matrix/the-dost-matrix/pull/42" },
            201,
          );
        }
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();
      const pr = await client.createPullRequest(TEST_TARGET, {
        title: "GitHub App-authenticatie i.p.v. fine-grained token",
        head: "feature/x",
        base: "main",
        body: "Zie missie-beschrijving.",
      });

      expect(pr).toEqual({ number: 42, url: "https://github.com/dost-matrix/the-dost-matrix/pull/42" });

      const pullsCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith("/pulls"));
      const [, init] = pullsCall as [unknown, RequestInit];
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
    });
  });

  describe("mergePullRequest", () => {
    it("merget een pull request met het installation-token", async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.endsWith("/pulls/42/merge")) return toResponse({ merged: true, sha: "merge-sha-000", message: "Merged" }, 200);
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();
      await client.mergePullRequest(TEST_TARGET, 42);

      const mergeCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith("/pulls/42/merge"));
      expect(mergeCall).toBeDefined();

      const [, init] = mergeCall as [unknown, RequestInit];
      expect(init.method).toBe("PUT");
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
    });

    /**
     * Bevinding F-03 (externe review, 20 september 2026): tussen de controle
     * van CI en succescriteria en de merge zelf kan er een nieuwe commit op de
     * branch komen. Zonder een verwachte SHA merget GitHub dan gewoon wat er op
     * dat moment staat — iets anders dan wat is gecontroleerd.
     */
    it("stuurt de verwachte head-SHA mee zodat GitHub weigert als de branch is verschoven", async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.endsWith("/pulls/42/merge")) return toResponse({ merged: true, sha: "merge-sha-000", message: "Merged" }, 200);
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();
      await client.mergePullRequest(TEST_TARGET, 42, { expectedHeadSha: "head-sha-abc" });

      const mergeCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith("/pulls/42/merge"));
      const [, init] = mergeCall as [unknown, RequestInit];
      const body = JSON.parse(String(init.body));

      expect(body.sha).toBe("head-sha-abc");
    });

    it("laat de SHA weg wanneer de aanroeper er geen meegeeft", async () => {
      // Zo blijft een aanroep zonder verwachting zich gedragen zoals voorheen,
      // in plaats van dat GitHub een lege sha te zien krijgt.
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.endsWith("/pulls/42/merge")) return toResponse({ merged: true, sha: "merge-sha-000", message: "Merged" }, 200);
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();
      await client.mergePullRequest(TEST_TARGET, 42);

      const mergeCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith("/pulls/42/merge"));
      const [, init] = mergeCall as [unknown, RequestInit];

      expect(JSON.parse(String(init.body))).not.toHaveProperty("sha");
    });

    it("gooit een fout wanneer GitHub meldt dat de pull request niet gemergd kon worden", async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.endsWith("/pulls/42/merge")) {
          return toResponse({ message: "Pull Request is not mergeable" }, 405);
        }
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();
      await expect(client.mergePullRequest(TEST_TARGET, 42)).rejects.toThrow();
    });
  });

  describe("getCombinedCheckStatus", () => {
    it("leest check-runs via de Checks-API, die nu bereikbaar is dankzij App-authenticatie", async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.includes("/check-runs")) {
          return toResponse({
            total_count: 2,
            check_runs: [
              { name: "lint", status: "completed", conclusion: "success" },
              { name: "test", status: "completed", conclusion: "success" },
            ],
          });
        }
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();
      const result = await client.getCombinedCheckStatus(TEST_TARGET, "a1b2c3d4e5f6");

      expect(result).toEqual({ state: "success", failingCheckNames: [], pendingCheckNames: [] });

      const checkRunsCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).includes("/check-runs"));
      expect(checkRunsCall).toBeDefined();

      const [, init] = checkRunsCall as [unknown, RequestInit];
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
    });
  });

  describe("installation-tokencaching over meerdere client-operaties heen", () => {
    it("hergebruikt hetzelfde installation-token voor meerdere opeenvolgende aanroepen", async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes("/access_tokens")) return accessTokenResponse();
        if (url.endsWith("/git/refs")) return toResponse({ ref: "refs/heads/feature/x" }, 201);
        if (url.includes("/contents/")) {
          return toResponse({ content: Buffer.from("x").toString("base64"), encoding: "base64", sha: "s" });
        }
        if (url.endsWith("/pulls")) {
          return toResponse({ number: 1, html_url: "https://example.invalid/pull/1" }, 201);
        }
        throw new Error(`Onverwachte fetch-aanroep: ${url}`);
      });

      const client = await loadClient();

      await client.createBranch(TEST_TARGET, "feature/x", "base-sha-123");
      await client.getFileContent(TEST_TARGET, "src/answer.ts", "feature/x");
      await client.createPullRequest(TEST_TARGET, {
        title: "title",
        head: "feature/x",
        base: "main",
        body: "",
      });

      expect(tokenExchangeCalls()).toHaveLength(1);

      const authHeaders = fetchMock.mock.calls
        .filter(([input]) => !requestUrl(input).includes("/access_tokens"))
        .map(([, init]) => authHeader(init));

      for (const header of authHeaders) {
        expect(header).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
      }
    });
  });
});
