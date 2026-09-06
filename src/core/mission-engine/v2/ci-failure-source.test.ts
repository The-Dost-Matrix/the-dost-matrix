import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Alleen de drie GitHub-functies worden vervangen; de rest van de module
 * blijft de echte (importOriginal) — zelfde reden als in
 * builder-runtime.mission-branch.test.ts.
 */
vi.mock("./github/github-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github/github-client")>();
  return {
    ...actual,
    getFailingCheckRuns: vi.fn(),
    getCheckRunAnnotations: vi.fn(),
    getJobLog: vi.fn(),
  };
});

import {
  getCheckRunAnnotations,
  getFailingCheckRuns,
  getJobLog,
} from "./github/github-client";

import { collectCiFailureReport } from "./ci-failure-source";

const TARGET = { owner: "The-Dost-Matrix", repo: "the-dost-matrix" };
const REF = "abc123";

const DETAILS_URL =
  "https://github.com/The-Dost-Matrix/the-dost-matrix/actions/runs/111/job/222";

beforeEach(() => {
  vi.mocked(getFailingCheckRuns).mockReset();
  vi.mocked(getCheckRunAnnotations).mockReset();
  vi.mocked(getJobLog).mockReset();

  vi.mocked(getCheckRunAnnotations).mockResolvedValue([]);
  vi.mocked(getJobLog).mockResolvedValue({ log: null, unavailableReason: null });
});

describe("collectCiFailureReport", () => {
  it("geeft null wanneer er geen gefaalde controles zijn", async () => {
    vi.mocked(getFailingCheckRuns).mockResolvedValue([]);

    expect(await collectCiFailureReport(TARGET, REF)).toBeNull();
    expect(getJobLog).not.toHaveBeenCalled();
  });

  it("haalt het logboek op van de taak uit de details-URL", async () => {
    vi.mocked(getFailingCheckRuns).mockResolvedValue([
      {
        name: "CI / Typecheck & import-check",
        checkRunId: 42,
        detailsUrl: DETAILS_URL,
        outputTitle: null,
        outputSummary: null,
      },
    ]);
    vi.mocked(getJobLog).mockResolvedValue({
      log: "src/core/x.ts(3,1): error TS2304: Cannot find name 'foo'.",
      unavailableReason: null,
    });

    const report = await collectCiFailureReport(TARGET, REF);

    expect(getJobLog).toHaveBeenCalledWith(TARGET, "222");
    expect(report).toContain("CI / Typecheck & import-check");
    expect(report).toContain("Cannot find name 'foo'");
  });

  it("zegt het expliciet wanneer er geen taak in de details-URL staat", async () => {
    vi.mocked(getFailingCheckRuns).mockResolvedValue([
      {
        name: "Externe controle",
        checkRunId: 7,
        detailsUrl: "https://example.com/geen-actions-url",
        outputTitle: null,
        outputSummary: null,
      },
    ]);

    const report = await collectCiFailureReport(TARGET, REF);

    expect(getJobLog).not.toHaveBeenCalled();
    expect(report).toContain("NIET opgehaald");
    expect(report).toContain("geen verwijzing naar een Actions-taak");
  });

  it("neemt de reden over waarom een logboek ontbreekt", async () => {
    vi.mocked(getFailingCheckRuns).mockResolvedValue([
      {
        name: "CI / Typecheck & import-check",
        checkRunId: 42,
        detailsUrl: DETAILS_URL,
        outputTitle: null,
        outputSummary: null,
      },
    ]);
    vi.mocked(getJobLog).mockResolvedValue({
      log: null,
      unavailableReason: 'de GitHub App heeft geen toegang tot Actions-logboeken',
    });

    const report = await collectCiFailureReport(TARGET, REF);

    expect(report).toContain("geen toegang tot Actions-logboeken");
  });

  it("onderzoekt hooguit drie gefaalde controles", async () => {
    vi.mocked(getFailingCheckRuns).mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        name: `controle ${index}`,
        checkRunId: index,
        detailsUrl: DETAILS_URL,
        outputTitle: null,
        outputSummary: null,
      })),
    );

    await collectCiFailureReport(TARGET, REF);

    expect(vi.mocked(getJobLog).mock.calls).toHaveLength(3);
  });
});
