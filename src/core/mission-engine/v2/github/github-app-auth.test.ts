import { createVerify, generateKeyPairSync } from 'crypto';

/**
 * Tests for the GitHub App installation authentication flow used by
 * `github-client.ts` to replace the previous static `GITHUB_BUILDER_TOKEN`.
 *
 * These tests never touch real GitHub infrastructure: `global.fetch` is
 * always mocked, and the RSA key pair used to sign/verify JWTs is generated
 * fresh in-memory for every test run via Node's `crypto` module. No real
 * App ID, Installation ID or private key is ever used or logged.
 */
describe('GitHub App authentication (getToken)', () => {
  const TEST_APP_ID = 'test-app-id-000111';
  const TEST_INSTALLATION_ID = 'test-installation-id-222333';

  let privateKeyPem: string;
  let publicKeyPem: string;

  const originalEnv = { ...process.env };

  beforeAll(() => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKeyPem = privateKey;
    publicKeyPem = publicKey;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
    jest.resetModules();
  });

  function decodeJwt(token: string): { header: any; payload: any } {
    const [headerB64, payloadB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return { header, payload };
  }

  function verifyJwtSignature(token: string, publicKey: string): boolean {
    const [headerB64, payloadB64, signatureB64] = token.split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    const signature = Buffer.from(signatureB64, 'base64url');
    return verifier.verify(publicKey, signature);
  }

  function mockAccessTokenResponse(token: string, expiresAtIso: string): any {
    return {
      ok: true,
      status: 201,
      json: async () => ({
        token,
        expires_at: expiresAtIso,
      }),
    };
  }

  /**
   * Sets the given environment variables (merged on top of the pristine
   * original environment), resets Jest's module registry so the client
   * module re-reads `process.env` and starts with a fresh in-memory token
   * cache, and re-imports the module under test.
   */
  async function loadClientWithEnv(env: Record<string, string>) {
    process.env = { ...originalEnv, ...env };
    jest.resetModules();
    return import('./github-client');
  }

  it('signs a well-formed RS256 JWT with iss=GITHUB_APP_ID and iat/exp within 10 minutes', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      mockAccessTokenResponse(
        'fake-installation-token-jwt-shape',
        new Date(Date.now() + 3600 * 1000).toISOString()
      )
    );
    (global as any).fetch = fetchMock;

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    });

    await getToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options]: [string, any] = fetchMock.mock.calls[0];
    const headers: Record<string, string> = options.headers ?? {};
    const authHeader = headers.Authorization ?? headers.authorization;

    expect(authHeader).toMatch(/^Bearer /);
    const jwt = authHeader.replace(/^Bearer /, '');

    const { header, payload } = decodeJwt(jwt);
    expect(header.alg).toBe('RS256');
    expect(payload.iss).toBe(TEST_APP_ID);

    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(10 * 60);
    // Allow a small amount of clock skew in either direction.
    expect(Math.abs(payload.iat - nowSeconds)).toBeLessThanOrEqual(120);

    expect(verifyJwtSignature(jwt, publicKeyPem)).toBe(true);
  });

  it('accepts a GITHUB_APP_PRIVATE_KEY containing literal \\n sequences instead of real newlines', async () => {
    const escapedPrivateKey = privateKeyPem.replace(/\n/g, '\\n');

    const fetchMock = jest.fn().mockResolvedValue(
      mockAccessTokenResponse(
        'fake-installation-token-escaped-key',
        new Date(Date.now() + 3600 * 1000).toISOString()
      )
    );
    (global as any).fetch = fetchMock;

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: escapedPrivateKey,
    });

    const token = await getToken();

    expect(token).toBe('fake-installation-token-escaped-key');

    const [, options]: [string, any] = fetchMock.mock.calls[0];
    const headers: Record<string, string> = options.headers ?? {};
    const authHeader = headers.Authorization ?? headers.authorization;
    const jwt = authHeader.replace(/^Bearer /, '');

    // If the literal "\n" characters were not normalized into real
    // newlines, signing would fail or produce a signature that does not
    // verify against the real PEM-formatted public key.
    expect(verifyJwtSignature(jwt, publicKeyPem)).toBe(true);
  });

  it('exchanges the App JWT for an installation access token via the correct endpoint', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      mockAccessTokenResponse(
        'fake-installation-token-exchange',
        new Date(Date.now() + 3600 * 1000).toISOString()
      )
    );
    (global as any).fetch = fetchMock;

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    });

    const token = await getToken();

    expect(token).toBe('fake-installation-token-exchange');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options]: [string, any] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://api.github.com/app/installations/${TEST_INSTALLATION_ID}/access_tokens`
    );
    expect(options.method).toBe('POST');

    const headers: Record<string, string> = options.headers ?? {};
    const accept = headers.Accept ?? headers.accept ?? '';
    expect(accept).toContain('application/vnd.github');

    const authHeader = headers.Authorization ?? headers.authorization;
    expect(authHeader).toMatch(/^Bearer /);
  });

  it('reuses the cached installation token on a subsequent call within its validity window', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      mockAccessTokenResponse(
        'fake-installation-token-cached',
        new Date(Date.now() + 3600 * 1000).toISOString()
      )
    );
    (global as any).fetch = fetchMock;

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    });

    const firstToken = await getToken();
    const secondToken = await getToken();

    expect(firstToken).toBe('fake-installation-token-cached');
    expect(secondToken).toBe('fake-installation-token-cached');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes the installation token automatically shortly before it expires', async () => {
    const start = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start);

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        mockAccessTokenResponse(
          'fake-installation-token-before-expiry',
          new Date(start + 3600 * 1000).toISOString()
        )
      )
      .mockResolvedValueOnce(
        mockAccessTokenResponse(
          'fake-installation-token-refreshed',
          new Date(start + 2 * 3600 * 1000).toISOString()
        )
      );
    (global as any).fetch = fetchMock;

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    });

    const firstToken = await getToken();
    expect(firstToken).toBe('fake-installation-token-before-expiry');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Move the clock to just one minute before the cached token's expiry.
    // A well-behaved implementation refreshes ahead of the exact expiry
    // instant, so this must trigger a new token exchange.
    nowSpy.mockReturnValue(start + 3600 * 1000 - 60 * 1000);

    const secondToken = await getToken();
    expect(secondToken).toBe('fake-installation-token-refreshed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propagates an error when GitHub rejects the installation token exchange', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Bad credentials' }),
    });
    (global as any).fetch = fetchMock;

    const { getToken } = await loadClientWithEnv({
      GITHUB_APP_ID: TEST_APP_ID,
      GITHUB_APP_INSTALLATION_ID: TEST_INSTALLATION_ID,
      GITHUB_APP_PRIVATE_KEY: privateKeyPem,
    });

    await expect(getToken()).rejects.toThrow();
  });
});