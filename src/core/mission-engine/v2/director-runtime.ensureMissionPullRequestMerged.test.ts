import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * director-runtime.ts importeert (indirect, via kennis-ophalen voor de
 * Director) `@/core/firebase/admin`, dat op moduleniveau meteen de Firebase
 * Admin SDK initialiseert. Zonder deze mock crasht elke test die dit bestand
 * importeert al bij het laden van de module — zie dezelfde mock in
 * director-runtime.test.ts.
 */
vi.mock("@/core/firebase/admin", () => ({
  adminAuth: {},
  adminDb: {},
  verifyIdToken: vi.fn(),
}));

/**
 * ensureMissionPullRequestMerged praat niet met één, maar met drie losse
 * modules: github-client.ts (GitHub API), qa-runtime.ts (om de pull request
 * van deze missie te vinden) en risk-classification.ts (om te bepalen of
 * automatisch mergen is toegestaan). Alle drie worden hier gemockt zodat het
 * gedrag van ensureMissionPullRequestMerged zelf getest kan worden, zonder
 * echte GitHub API-aanroepen.
 *
 * Belangrijk: eerdere pogingen om dit te testen (zie het commentaar boven
 * ensureMissionPullRequestMerged in director-runtime.ts) riepen de functie
 * aan met een verzonnen, los object (`{owner, repo, pullNumber, headSha,
 * riskClassification}`) dat nooit bij de echte signatuur paste — de functie
 * accepteert uitsluitend een echte `MissionV2` en zoekt de bijbehorende pull
 * request zelf op. Deze tests gebruiken daarom een MissionV2-achtige invoer
 * en mocken de opzoekfuncties, in plaats van de pull request rechtstreeks
 * mee te geven.
 */
vi.mock("./github/github-client", () => ({
  GithubApiError: class GithubApiError extends Error {},
  getGithubRepoTarget: vi.fn(),
  listPullRequests: vi.fn(),
  getCombinedCheckStatus: vi.fn(),
  getPullRequestFiles: vi.fn(),
  mergePullRequest: vi.fn(),
}));

vi.mock("./qa-runtime", () => ({
  findMissionPullRequest: vi.fn(),
}));

vi.mock("./risk-classification", () => ({
  classifyPullRequestRiskForMission: vi.fn(),
}));

import { ensureMissionPullRequestMerged, DirectorRuntimeError } from "./director-runtime";
import {
  getGithubRepoTarget,
  listPullRequests,
  getCombinedCheckStatus,
  getPullRequestFiles,
  mergePullRequest,
  type PullRequestSummary,
} from "./github/github-client";
import { findMissionPullRequest } from "./qa-runtime";
import { classifyPullRequestRiskForMission } from "./risk-classification";
import type { MissionV2 } from "./mission";

const TARGET = { owner: "The-Dost-Matrix", repo: "the-dost-matrix" };

function buildMission(overrides: Partial<MissionV2> = {}): MissionV2 {
  return {
    missionId: "abc12345-0000-0000-0000-000000000000",
    title: "Voorbeeldmissie",
    riskLevel: "LOW",
    ...overrides,
  } as unknown as MissionV2;
}

function buildPullRequest(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 42,
    headRef: "director/mission-abc12345-1700000000000",
    headSha: "abc123def456",
    merged: false,
    state: "open",
    url: "https://github.com/The-Dost-Matrix/the-dost-matrix/pull/42",
    title: "Voorbeeldmissie",
    ...overrides,
  };
}

describe("ensureMissionPullRequestMerged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGithubRepoTarget).mockReturnValue(TARGET);
    vi.mocked(listPullRequests).mockResolvedValue([]);
  });

  it("doet niets wanneer er geen pull request voor deze missie gevonden wordt", async () => {
    vi.mocked(findMissionPullRequest).mockReturnValue(null);

    await expect(ensureMissionPullRequestMerged(buildMission())).resolves.toBeUndefined();

    expect(getCombinedCheckStatus).not.toHaveBeenCalled();
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it("doet niets wanneer de pull request al gemerged is", async () => {
    vi.mocked(findMissionPullRequest).mockReturnValue(buildPullRequest({ merged: true }));

    await expect(ensureMissionPullRequestMerged(buildMission())).resolves.toBeUndefined();

    expect(getCombinedCheckStatus).not.toHaveBeenCalled();
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it("gooit CI_CHECKS_FAILED en mergt niet wanneer de combined check status 'failure' is", async () => {
    const pr = buildPullRequest();
    vi.mocked(findMissionPullRequest).mockReturnValue(pr);
    vi.mocked(getCombinedCheckStatus).mockResolvedValue({
      state: "failure",
      failingCheckNames: ["CI / Typecheck & import-check"],
      pendingCheckNames: [],
    });

    let caughtError: unknown;
    try {
      await ensureMissionPullRequestMerged(buildMission());
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(DirectorRuntimeError);
    expect((caughtError as DirectorRuntimeError).code).toBe("CI_CHECKS_FAILED");
    expect(getCombinedCheckStatus).toHaveBeenCalledWith(TARGET, pr.headSha);
    expect(getPullRequestFiles).not.toHaveBeenCalled();
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it("gooit CI_CHECKS_PENDING en mergt niet wanneer de combined check status 'pending' is", async () => {
    const pr = buildPullRequest();
    vi.mocked(findMissionPullRequest).mockReturnValue(pr);
    vi.mocked(getCombinedCheckStatus).mockResolvedValue({
      state: "pending",
      failingCheckNames: [],
      pendingCheckNames: ["CI / Typecheck & import-check"],
    });

    let caughtError: unknown;
    try {
      await ensureMissionPullRequestMerged(buildMission());
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(DirectorRuntimeError);
    expect((caughtError as DirectorRuntimeError).code).toBe("CI_CHECKS_PENDING");
    expect(mergePullRequest).not.toHaveBeenCalled();
  });

  it("mergt de pull request wanneer de CI geslaagd is en de risicoclassificatie auto-approve toestaat", async () => {
    const pr = buildPullRequest();
    vi.mocked(findMissionPullRequest).mockReturnValue(pr);
    vi.mocked(getCombinedCheckStatus).mockResolvedValue({
      state: "success",
      failingCheckNames: [],
      pendingCheckNames: [],
    });
    vi.mocked(getPullRequestFiles).mockResolvedValue([
      { filename: "src/core/mission-engine/v2/director-runtime.ts", status: "modified" },
    ]);
    vi.mocked(classifyPullRequestRiskForMission).mockReturnValue({
      level: "auto-approve",
      reason: "Geïsoleerde wijziging zonder kritiek pad.",
    });
    vi.mocked(mergePullRequest).mockResolvedValue({
      merged: true,
      sha: "def789",
      message: "Pull Request successfully merged",
    });

    await expect(ensureMissionPullRequestMerged(buildMission())).resolves.toBeUndefined();

    expect(mergePullRequest).toHaveBeenCalledTimes(1);
    expect(mergePullRequest).toHaveBeenCalledWith(
      TARGET,
      pr.number,
      expect.objectContaining({ mergeMethod: "merge" }),
    );
  });

  it("gooit NEEDS_SIGNOFF en mergt niet wanneer de risicoclassificatie needs-signoff is, ook al is de CI geslaagd", async () => {
    const pr = buildPullRequest();
    vi.mocked(findMissionPullRequest).mockReturnValue(pr);
    vi.mocked(getCombinedCheckStatus).mockResolvedValue({
      state: "success",
      failingCheckNames: [],
      pendingCheckNames: [],
    });
    vi.mocked(getPullRequestFiles).mockResolvedValue([
      { filename: "src/core/firebase/admin.ts", status: "modified" },
    ]);
    vi.mocked(classifyPullRequestRiskForMission).mockReturnValue({
      level: "needs-signoff",
      reason: "Wijziging raakt een kritiek pad.",
    });

    let caughtError: unknown;
    try {
      await ensureMissionPullRequestMerged(buildMission());
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(DirectorRuntimeError);
    expect((caughtError as DirectorRuntimeError).code).toBe("NEEDS_SIGNOFF");
    expect(mergePullRequest).not.toHaveBeenCalled();
  });
});
