import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Alleen de GitHub-functies worden vervangen; de echte module wordt verder
 * behouden (importOriginal) zodat `GithubApiError` dezelfde klasse blijft als
 * die `ensureMissionBranch` in zijn instanceof-controle gebruikt. Een eigen
 * nagebouwde foutklasse zou die controle stilzwijgend laten falen.
 */
vi.mock("./github/github-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github/github-client")>();
  return {
    ...actual,
    getBranchHeadSha: vi.fn(),
    createBranch: vi.fn(),
  };
});

import {
  GithubApiError,
  createBranch,
  getBranchHeadSha,
  type PullRequestSummary,
} from "./github/github-client";

import { ensureMissionBranch, findOpenMissionPullRequest } from "./builder-runtime";
import { MISSION_BRANCH_NAME, QA_BRANCH_PREFIX } from "./mission-branch";

const TARGET = { owner: "The-Dost-Matrix", repo: "the-dost-matrix" };
const MISSION_ID = "abc12345-0000-0000-0000-000000000000";
const MISSION_BRANCH = MISSION_BRANCH_NAME(MISSION_ID);

function buildPullRequest(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 42,
    headRef: MISSION_BRANCH,
    headSha: "abc123",
    merged: false,
    state: "open",
    url: "https://github.com/The-Dost-Matrix/the-dost-matrix/pull/42",
    title: "Voorbeeld",
    ...overrides,
  };
}

describe("MISSION_BRANCH_NAME", () => {
  it("begint met de QA-prefix, zodat findMissionPullRequest ongewijzigd blijft werken", () => {
    expect(MISSION_BRANCH).toContain(QA_BRANCH_PREFIX(MISSION_ID));
    expect(MISSION_BRANCH.startsWith(QA_BRANCH_PREFIX(MISSION_ID))).toBe(true);
  });

  it("is stabiel: dezelfde missie geeft altijd exact dezelfde branchnaam", () => {
    // De kern van stap 9. De vorige implementatie zette hier Date.now() in,
    // waardoor elke toewijzing op een eigen branch terechtkwam.
    expect(MISSION_BRANCH_NAME(MISSION_ID)).toBe(MISSION_BRANCH_NAME(MISSION_ID));
    expect(MISSION_BRANCH).not.toMatch(/\d{10,}/);
  });
});

describe("ensureMissionBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hergebruikt de bestaande missiebranch en maakt geen nieuwe aan", async () => {
    vi.mocked(getBranchHeadSha).mockResolvedValue("sha-van-de-missiebranch");

    const result = await ensureMissionBranch(TARGET, MISSION_BRANCH, "main");

    expect(result).toEqual({ created: false });
    expect(getBranchHeadSha).toHaveBeenCalledWith(TARGET, MISSION_BRANCH);
    expect(createBranch).not.toHaveBeenCalled();
  });

  it("maakt de branch aan vanaf de kop van de standaardbranch wanneer hij nog niet bestaat", async () => {
    vi.mocked(getBranchHeadSha)
      .mockRejectedValueOnce(new GithubApiError(404, "Branch not found"))
      .mockResolvedValueOnce("sha-van-main");

    const result = await ensureMissionBranch(TARGET, MISSION_BRANCH, "main");

    expect(result).toEqual({ created: true });
    expect(getBranchHeadSha).toHaveBeenNthCalledWith(1, TARGET, MISSION_BRANCH);
    expect(getBranchHeadSha).toHaveBeenNthCalledWith(2, TARGET, "main");
    expect(createBranch).toHaveBeenCalledWith(TARGET, MISSION_BRANCH, "sha-van-main");
  });

  it("gooit een andere GitHub-fout door en maakt dan géén branch aan", async () => {
    // Belangrijk: alleen een 404 betekent "bestaat nog niet". Bij bijvoorbeeld
    // een 500 mag er geen branch worden aangemaakt op een verkeerde basis.
    vi.mocked(getBranchHeadSha).mockRejectedValue(new GithubApiError(500, "Server error"));

    await expect(ensureMissionBranch(TARGET, MISSION_BRANCH, "main")).rejects.toThrow(
      GithubApiError,
    );

    expect(createBranch).not.toHaveBeenCalled();
  });

  it("gooit ook een niet-GitHub-fout door zonder branch aan te maken", async () => {
    vi.mocked(getBranchHeadSha).mockRejectedValue(new Error("netwerk onbereikbaar"));

    await expect(ensureMissionBranch(TARGET, MISSION_BRANCH, "main")).rejects.toThrow(
      /netwerk onbereikbaar/,
    );

    expect(createBranch).not.toHaveBeenCalled();
  });
});

describe("findOpenMissionPullRequest", () => {
  it("vindt de open pull request van exact deze missiebranch", () => {
    const pr = buildPullRequest();

    expect(findOpenMissionPullRequest([pr], MISSION_BRANCH)).toBe(pr);
  });

  it("negeert een oudere tijdstempel-branch van dezelfde missie", () => {
    // Missies van vóór stap 9 hebben branches als
    // director/mission-abc12345-1788539538423. Die beginnen met dezelfde
    // prefix, maar zijn niet de huidige werkbranch.
    const oude = buildPullRequest({
      headRef: `${QA_BRANCH_PREFIX(MISSION_ID)}1788539538423`,
      number: 41,
    });

    expect(findOpenMissionPullRequest([oude], MISSION_BRANCH)).toBeNull();
  });

  it("negeert een al gemergde of gesloten pull request van dezelfde branch", () => {
    const gemerged = buildPullRequest({ merged: true, state: "closed" });
    const gesloten = buildPullRequest({ number: 43, state: "closed" });

    expect(findOpenMissionPullRequest([gemerged, gesloten], MISSION_BRANCH)).toBeNull();
  });

  it("geeft null terug wanneer er helemaal geen pull requests zijn", () => {
    expect(findOpenMissionPullRequest([], MISSION_BRANCH)).toBeNull();
  });
});
