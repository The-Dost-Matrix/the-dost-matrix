/**
 * Tests for github-client.ts
 *
 * These tests exercise the higher level GitHub REST operations (branches,
 * files, pull requests, merges and combined check status) that the Mission
 * Engine relies on. All network access is mocked; no real GitHub App
 * credentials, private keys, App IDs or Installation IDs are used anywhere
 * in this file — only fictitious, locally generated test values.
 *
 * The GitHub App authentication flow itself (JWT signing, installation
 * token exchange and cache/refresh behaviour) is covered in detail in
 * `github-app-auth.test.ts`. Here we only verify that:
 *  - the client no longer depends on `GITHUB_BUILDER_TOKEN`
 *  - every REST call is authenticated with the installation access token
 *  - the installation token is fetched once and reused across calls
 *  - existing branch/PR/merge/file functionality keeps working unchanged
 *  - `getCombinedCheckStatus` can reach the Checks API, which was
 *    previously unreachable with a fine-grained personal access token
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

// A fresh, throwaway RSA key pair generated purely for this test run.
// This is NOT a real GitHub App private key and is never persisted or logged.
const { privateKey: TEST_PRIVATE_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

const TEST_APP_ID = '000000';
const TEST_INSTALLATION_ID = '111111';
const TEST_INSTALLATION_TOKEN = 'ghs_fake_test_installation_token';

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
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function accessTokenResponse(token = TEST_INSTALLATION_TOKEN, expiresInSeconds = 3600) {
  return toResponse(
    {
      token,
      expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      permissions: { checks: 'read' },
    },
    201,
  );
}

/** Extracts the request URL as a plain string, whichever way fetch was called. */
function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  const maybeToString = input as { toString(): string } | undefined;
  return maybeToString ? maybeToString.toString() : '';
}

/** Extracts the Authorization header from a fetch init object, if present. */
function authHeader(init: unknown): string | undefined {
  const headers = (init as { headers?: Record<string, string> } | undefined)?.headers;
  if (!headers) return undefined;
  return headers.Authorization ?? headers.authorization;
}

describe('github-client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env.GITHUB_APP_ID = TEST_APP_ID;
    process.env.GITHUB_APP_INSTALLATION_ID = TEST_INSTALLATION_ID;
    process.env.GITHUB_APP_PRIVATE_KEY = TEST_PRIVATE_KEY;
    delete process.env.GITHUB_BUILDER_TOKEN;

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
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
    return import('./github-client');
  }

  function tokenExchangeCalls() {
    return fetchMock.mock.calls.filter(([input]) =>
      requestUrl(input).includes(`/app/installations/${TEST_INSTALLATION_ID}/access_tokens`),
    );
  }

  it('does not read or require GITHUB_BUILDER_TOKEN anymore', async () => {
    expect(process.env.GITHUB_BUILDER_TOKEN).toBeUndefined();

    fetchMock.mockImplementation(async (input: unknown) => {
      if (requestUrl(input).includes('/access_tokens')) return accessTokenResponse();
      return toResponse({ ref: 'refs/heads/feature/x' }, 201);
    });

    const client = await loadClient();
    expect(client).toBeDefined();

    await client.createBranch('dost-matrix', 'the-dost-matrix', 'feature/x', 'base-sha-123');

    expect(tokenExchangeCalls()).toHaveLength(1);
  });

  describe('createBranch', () => {
    it('creates a new ref authenticated with the installation token', async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes('/access_tokens')) return accessTokenResponse();
        if (url.endsWith('/git/refs')) return toResponse({ ref: 'refs/heads/feature/x' }, 201);
        throw new Error(`Unexpected fetch call: ${url}`);
      });

      const client = await loadClient();
      await client.createBranch('dost-matrix', 'the-dost-matrix', 'feature/x', 'base-sha-123');

      const refsCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith('/git/refs'));
      expect(refsCall).toBeDefined();

      const [, init] = refsCall as [unknown, RequestInit];
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
      expect(init.method).toBe('POST');

      const body = JSON.parse(String(init.body));
      expect(body.ref).toBe('refs/heads/feature/x');
      expect(body.sha).toBe('base-sha-123');
    });

    it('propagates errors when GitHub rejects the branch creation', async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes('/access_tokens')) return accessTokenResponse();
        if (url.endsWith('/git/refs')) return toResponse({ message: 'Reference already exists' }, 422);
        throw new Error(`Unexpected fetch call: ${url}`);
      });

      const client = await loadClient();
      await expect(
        client.createBranch('dost-matrix', 'the-dost-matrix', 'feature/x', 'base-sha-123'),
      ).rejects.toThrow();
    });
  });

  describe('getFileContent', () => {
    it('decodes base64 file content returned by the contents API', async () => {
      const rawContent = 'export const answer = 42;\n';
      const encoded = Buffer.from(rawContent, 'utf-8').toString('base64');

      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes('/access_tokens')) return accessTokenResponse();
        if (url.includes('/contents/')) {
          return toResponse({ content: encoded, encoding: 'base64', sha: 'file-sha-456' });
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      });

      const client = await loadClient();
      const file = await client.getFileContent(
        'dost-matrix',
        'the-dost-matrix',
        'src/answer.ts',
        'feature/x',
      );

      expect(file).toEqual({ content: rawContent, sha: 'file-sha-456' });

      const contentsCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).includes('/contents/'));
      const [, init] = contentsCall as [unknown, RequestInit];
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
    });

    it('returns null when the file does not exist (404)', async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes('/access_tokens')) return accessTokenResponse();
        if (url.includes('/contents/')) return toResponse({ message: 'Not Found' }, 404);
        throw new Error(`Unexpected fetch call: ${url}`);
      });

      const client = await loadClient();
      const file = await client.getFileContent(
        'dost-matrix',
        'the-dost-matrix',
        'src/missing.ts',
        'feature/x',
      );

      expect(file).toBeNull();
    });
  });

  describe('createOrUpdateFile', () => {
    it('base64-encodes the content and includes the sha when updating', async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes('/access_tokens')) return accessTokenResponse();
        if (url.includes('/contents/')) return toResponse({ commit: { sha: 'commit-sha-789' } }, 200);
        throw new Error(`Unexpected fetch call: ${url}`);
      });

      const client = await loadClient();
      await client.createOrUpdateFile(
        'dost-matrix',
        'the-dost-matrix',
        'src/answer.ts',
        'export const answer = 43;\n',
        'chore: update answer',
        'feature/x',
        'file-sha-456',
      );

      const putCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).includes('/contents/'));
      const [, init] = putCall as [unknown, RequestInit];

      expect(init.method).toBe('PUT');
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);

      const body = JSON.parse(String(init.body));
      expect(body.sha).toBe('file-sha-456');
      expect(body.message).toBe('chore: update answer');
      expect(Buffer.from(body.content, 'base64').toString('utf-8')).toBe('export const answer = 43;\n');
    });
  });

  describe('createPullRequest', () => {
    it('creates a pull request and returns its number and URL', async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes('/access_tokens')) return accessTokenResponse();
        if (url.endsWith('/pulls')) {
          return toResponse(
            { number: 42, html_url: 'https://github.com/dost-matrix/the-dost-matrix/pull/42' },
            201,
          );
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      });

      const client = await loadClient();
      const pr = await client.createPullRequest(
        'dost-matrix',
        'the-dost-matrix',
        'GitHub App-authenticatie i.p.v. fine-grained token',
        'feature/x',
        'main',
        'Zie missie-beschrijving.',
      );

      expect(pr).toEqual({ number: 42, html_url: 'https://github.com/dost-matrix/the-dost-matrix/pull/42' });

      const pullsCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith('/pulls'));
      const [, init] = pullsCall as [unknown, RequestInit];
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
    });
  });

  describe('mergePullRequest', () => {
    it('merges a pull request using the installation token', async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes('/access_tokens')) return accessTokenResponse();
        if (url.endsWith('/pulls/42/merge')) return toResponse({ merged: true, sha: 'merge-sha-000' }, 200);
        throw new Error(`Unexpected fetch call: ${url}`);
      });

      const client = await loadClient();
      await client.mergePullRequest('dost-matrix', 'the-dost-matrix', 42);

      const mergeCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).endsWith('/pulls/42/merge'));
      expect(mergeCall).toBeDefined();

      const [, init] = mergeCall as [unknown, RequestInit];
      expect(init.method).toBe('PUT');
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
    });

    it('throws when GitHub reports the pull request could not be merged', async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes('/access_tokens')) return accessTokenResponse();
        if (url.endsWith('/pulls/42/merge')) {
          return toResponse({ message: 'Pull Request is not mergeable' }, 405);
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      });

      const client = await loadClient();
      await expect(client.mergePullRequest('dost-matrix', 'the-dost-matrix', 42)).rejects.toThrow();
    });
  });

  describe('getCombinedCheckStatus', () => {
    it('reads check runs via the Checks API, which is now reachable through App auth', async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes('/access_tokens')) return accessTokenResponse();
        if (url.includes('/check-runs')) {
          return toResponse({
            total_count: 2,
            check_runs: [
              { name: 'lint', status: 'completed', conclusion: 'success' },
              { name: 'test', status: 'completed', conclusion: 'success' },
            ],
          });
        }
        if (url.includes('/status')) {
          return toResponse({ state: 'success', statuses: [] });
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      });

      const client = await loadClient();
      const result = await client.getCombinedCheckStatus(
        'dost-matrix',
        'the-dost-matrix',
        'a1b2c3d4e5f6',
      );

      expect(result).toBeDefined();

      const checkRunsCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).includes('/check-runs'));
      expect(checkRunsCall).toBeDefined();

      const [, init] = checkRunsCall as [unknown, RequestInit];
      expect(authHeader(init)).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
    });
  });

  describe('installation token caching across client operations', () => {
    it('reuses the same installation token for multiple sequential calls', async () => {
      fetchMock.mockImplementation(async (input: unknown) => {
        const url = requestUrl(input);
        if (url.includes('/access_tokens')) return accessTokenResponse();
        if (url.endsWith('/git/refs')) return toResponse({ ref: 'refs/heads/feature/x' }, 201);
        if (url.includes('/contents/')) {
          return toResponse({ content: Buffer.from('x').toString('base64'), sha: 's' });
        }
        if (url.endsWith('/pulls')) {
          return toResponse({ number: 1, html_url: 'https://example.invalid/pull/1' }, 201);
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      });

      const client = await loadClient();

      await client.createBranch('dost-matrix', 'the-dost-matrix', 'feature/x', 'base-sha-123');
      await client.getFileContent('dost-matrix', 'the-dost-matrix', 'src/answer.ts', 'feature/x');
      await client.createPullRequest('dost-matrix', 'the-dost-matrix', 'title', 'feature/x', 'main');

      expect(tokenExchangeCalls()).toHaveLength(1);

      const authHeaders = fetchMock.mock.calls
        .filter(([input]) => !requestUrl(input).includes('/access_tokens'))
        .map(([, init]) => authHeader(init));

      for (const header of authHeaders) {
        expect(header).toBe(`Bearer ${TEST_INSTALLATION_TOKEN}`);
      }
    });
  });
});