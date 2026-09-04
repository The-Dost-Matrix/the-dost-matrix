import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";

/**
 * Tests voor de GitHub App-installatie-authenticatie (JWT-ondertekening +
 * inwisselen voor een installation access token) in github-client.ts, die
 * de vroegere statische `GITHUB_BUILDER_TOKEN` vervangt.
 *
 * Deze tests raken nooit echte GitHub-infrastructuur aan: `fetch` wordt
 * altijd gemockt via `vi.stubGlobal`, en het RSA-sleutelpaar om JWT's mee te
 * ondertekenen/verifiëren wordt vers in het geheugen gegenereerd via Node's
 * `crypto`-module. Er wordt nergens een echt App ID, Installation ID of
 * private key gebruikt of gelogd.
 *
 * `github-client.ts` leest environment variables en het gecachete token pas
 * bij aanroep van `getToken()`, niet bij het importeren van de module — vandaar
 * `vi.resetModules()` + een verse dynamische `import()` per test, zodat elke
 * test met een schone module-instantie (en dus een leeg tokencache) begint.
 */
describe("GitHub App-authenticatie (getToken)", () => {
  const TEST_APP_ID = "test-app-id-000111";
  const TEST_INSTALLATION_ID = "test-installation-id-222333";

  let privateKeyPem: string;
  let publicKeyPem: string;

  const originalEnv = { ...process.env };

  beforeAll(() => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    privateKeyPem = privateKey;
    publicKeyPem = publicKey;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function decodeJwt(token: string): { header: { alg: string }; payload: { iss: string; iat: number; exp: number } } {
    const [headerB64, payloadB64] = token.split(".");
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    return { header, payload };
  }

  function verifyJwtSignature(token: string, publicKey: string): boolean {
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    const signature = Buffer.from(signatureB64, "base64url");
    return verifier.verify(publicKey, signature);
  }

  function mockAccessTokenResponse(token: string, expiresAtIso: string) {
    return {
      ok: true,
      status: 201,
      json: async () => ({ token, expires_at: expiresAtIso }),
      text: async () => JSON.stringify({ token, expires_at: expiresAtIso }),
    } as Response;
  }

  /**
   * Zet de gegeven omgevingsvariabelen (bovenop de oorspronkelijke,
   * ongewijzigde omgeving), reset vitest's moduleregister zodat de client
   * opnieuw `process.env` inleest en met een vers, leeg tokencache begint,
   * en importeert de module onder test opnieuw.
   */
  async function loadClientWithEnv(env: Record<string, string>) {
    process.env = { ...originalEnv, ...env };
    vi.resetModules();
    return import("./github-client");
  }

  it("ondertekent een geldige RS256-JWT met iss=GITHUB_APP_ID en iat/exp binnen 10 minuten", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockAccessTokenResponse("fake-installation-token-jwt-shape", new Date(Date.now() + 3600 * 1000).toISOString()),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    });

    await getToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    const headers = options.headers ?? {};
    const authHeader = headers.Authorization ?? headers.authorization;

    expect(authHeader).toMatch(/^Bearer /);
    const jwt = authHeader!.replace(/^Bearer /, "");

    const { header, payload } = decodeJwt(jwt);
    expect(header.alg).toBe("RS256");
    expect(payload.iss).toBe(TEST_APP_ID);

    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(10 * 60);
    // Ruimte voor een kleine kloksynchronisatie-afwijking in beide richtingen.
    expect(Math.abs(payload.iat - nowSeconds)).toBeLessThanOrEqual(120);

    expect(verifyJwtSignature(jwt, publicKeyPem)).toBe(true);
  });

  it("accepteert een GITHUB_APP_PRIVATE_KEY met letterlijke \\n-tekens in plaats van echte regeleindes", async () => {
    const escapedPrivateKey = privateKeyPem.replace(/\n/g, "\\n");

    const fetchMock = vi.fn().mockResolvedValue(
      mockAccessTokenResponse("fake-installation-token-escaped-key", new Date(Date.now() + 3600 * 1000).toISOString()),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: escapedPrivateKey,
    });

    const token = await getToken();

    expect(token).toBe("fake-installation-token-escaped-key");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    const headers = options.headers ?? {};
    const authHeader = headers.Authorization ?? headers.authorization;
    const jwt = authHeader!.replace(/^Bearer /, "");

    // Als de letterlijke "\n"-tekens niet naar echte regeleindes waren
    // genormaliseerd, zou ondertekenen mislukken of een handtekening
    // opleveren die niet verifieert tegen de echte PEM-geformatteerde
    // publieke sleutel.
    expect(verifyJwtSignature(jwt, publicKeyPem)).toBe(true);
  });

  it("wisselt de App-JWT in voor een installation access token via het juiste endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockAccessTokenResponse("fake-installation-token-exchange", new Date(Date.now() + 3600 * 1000).toISOString()),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    });

    const token = await getToken();

    expect(token).toBe("fake-installation-token-exchange");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(`https://api.github.com/app/installations/${TEST_INSTALLATION_ID}/access_tokens`);
    expect(options.method).toBe("POST");

    const headers = options.headers ?? {};
    const accept = headers.Accept ?? headers.accept ?? "";
    expect(accept).toContain("application/vnd.github");

    const authHeader = headers.Authorization ?? headers.authorization;
    expect(authHeader).toMatch(/^Bearer /);
  });

  it("hergebruikt het gecachete installation-token bij een volgende aanroep binnen de geldigheidsduur", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockAccessTokenResponse("fake-installation-token-cached", new Date(Date.now() + 3600 * 1000).toISOString()),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    });

    const firstToken = await getToken();
    const secondToken = await getToken();

    expect(firstToken).toBe("fake-installation-token-cached");
    expect(secondToken).toBe("fake-installation-token-cached");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ververst het installation-token automatisch vlak vóórdat het verloopt", async () => {
    const start = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(start);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockAccessTokenResponse("fake-installation-token-before-expiry", new Date(start + 3600 * 1000).toISOString()),
      )
      .mockResolvedValueOnce(
        mockAccessTokenResponse("fake-installation-token-refreshed", new Date(start + 2 * 3600 * 1000).toISOString()),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    });

    const firstToken = await getToken();
    expect(firstToken).toBe("fake-installation-token-before-expiry");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Zet de klok op precies één minuut vóór het verlopen van het gecachete
    // token. Een correcte implementatie ververst ruim vóór het exacte
    // verloopmoment (zie TOKEN_REFRESH_MARGIN_MS in github-client.ts), dus
    // dit moet een nieuwe tokenuitwisseling veroorzaken.
    nowSpy.mockReturnValue(start + 3600 * 1000 - 60 * 1000);

    const secondToken = await getToken();
    expect(secondToken).toBe("fake-installation-token-refreshed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("geeft een fout door wanneer GitHub de installation-tokenuitwisseling weigert", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ message: "Bad credentials" }),
      text: async () => JSON.stringify({ message: "Bad credentials" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    });

    await expect(getToken()).rejects.toThrow();
  });
});
