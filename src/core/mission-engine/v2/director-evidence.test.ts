import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests bij stap 17 (Director Evidence Upgrade).
 *
 * Twee dingen worden hier bewaakt. Ten eerste dát het bewijs meegaat: de
 * Director zag vóór deze stap alleen rol, status en zijn eigen opdrachttekst
 * terug, en besliste dus over de volgende stap zonder te weten wat de vorige
 * had opgeleverd. Ten tweede de begrenzingen eromheen — een vastgelopen
 * herstellus mag de prompt niet laten meegroeien, en een onbereikbare GitHub
 * mag een missie nooit stilzetten.
 */
vi.mock("./github/github-client", () => ({
  getGithubRepoTarget: vi.fn(),
  listPullRequests: vi.fn(),
  getCombinedCheckStatus: vi.fn(),
  getPullRequestFiles: vi.fn(),
}));

vi.mock("./qa-runtime", () => ({
  findMissionPullRequest: vi.fn(),
}));

import {
  buildAssignmentEvidenceLines,
  formatPullRequestEvidence,
  gatherPullRequestEvidence,
  type PullRequestEvidence,
} from "./director-evidence";
import {
  getCombinedCheckStatus,
  getGithubRepoTarget,
  getPullRequestFiles,
  listPullRequests,
} from "./github/github-client";
import { findMissionPullRequest } from "./qa-runtime";
import type { MissionAssignmentRecord, MissionV2 } from "./mission";

const mockedTarget = vi.mocked(getGithubRepoTarget);
const mockedList = vi.mocked(listPullRequests);
const mockedChecks = vi.mocked(getCombinedCheckStatus);
const mockedFiles = vi.mocked(getPullRequestFiles);
const mockedFind = vi.mocked(findMissionPullRequest);

function makeAssignment(
  overrides: Partial<MissionAssignmentRecord> = {},
): MissionAssignmentRecord {
  return {
    assignmentId: "asg-1",
    decisionId: "dec-1",
    roleId: "builder",
    status: "COMPLETED",
    objective: "Voeg een utility toe",
    successCriteria: ["crit-1"],
    createdAt: "2026-09-13T10:00:00.000Z",
    updatedAt: "2026-09-13T10:05:00.000Z",
    ...overrides,
  };
}

function makeMission(assignments: MissionAssignmentRecord[]): MissionV2 {
  return {
    missionId: "mis-1",
    ownerId: "owner-1",
    projectId: "prj-1",
    goalRefs: [],
    title: "Testmissie",
    objective: "Iets bouwen",
    status: "ACTIVE",
    priority: 1,
    riskLevel: "LOW",
    budget: { maximumCost: 50, currency: "EUR" },
    spentCost: 0,
    successCriteria: [],
    constraints: [],
    assignments,
    activeAssignmentIds: [],
    ownerApprovalState: "NOT_REQUIRED",
    version: 1,
    createdAt: "2026-09-13T10:00:00.000Z",
    updatedAt: "2026-09-13T10:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("buildAssignmentEvidenceLines", () => {
  it("meldt expliciet dat er nog niets is gebeurd", () => {
    expect(buildAssignmentEvidenceLines([])).toBe("Nog geen eerdere toewijzingen.");
  });

  it("toont wat een toewijzing heeft opgeleverd, niet alleen zijn status", () => {
    const lines = buildAssignmentEvidenceLines([
      makeAssignment({
        resultSummary: "PR #58 geopend met formatCents plus acht tests.",
      }),
    ]);

    expect(lines).toContain("rol=builder");
    expect(lines).toContain("status=COMPLETED");
    // De kern van stap 17: dit stond al opgeslagen maar bereikte de Director niet.
    expect(lines).toContain("PR #58 geopend met formatCents plus acht tests.");
  });

  it("benoemt een ontbrekende samenvatting in plaats van de regel weg te laten", () => {
    const lines = buildAssignmentEvidenceLines([makeAssignment()]);

    expect(lines).toContain("(geen samenvatting vastgelegd)");
  });

  it("toont de soort toewijzing, zodat een herstelpoging herkenbaar is", () => {
    const lines = buildAssignmentEvidenceLines([
      makeAssignment({ kind: "TECHNICAL_REPAIR" }),
    ]);

    expect(lines).toContain("soort=TECHNICAL_REPAIR");
  });

  it("laat soort weg wanneer die niet is vastgelegd", () => {
    expect(buildAssignmentEvidenceLines([makeAssignment()])).not.toContain("soort=");
  });

  it("begrenst het aantal toewijzingen en meldt hoeveel er zijn weggelaten", () => {
    const assignments = Array.from({ length: 9 }, (unused, index) =>
      makeAssignment({
        assignmentId: `asg-${index + 1}`,
        objective: `Opdracht ${index + 1}`,
      }),
    );

    const lines = buildAssignmentEvidenceLines(assignments, { maxAssignments: 4 });

    expect(lines).toContain("5 oudere toewijzingen weggelaten");
    expect(lines).not.toContain("Opdracht 1");
    expect(lines).toContain("Opdracht 9");
  });

  it("nummert door vanaf de echte positie, niet vanaf 1", () => {
    const assignments = Array.from({ length: 5 }, (unused, index) =>
      makeAssignment({ objective: `Opdracht ${index + 1}` }),
    );

    const lines = buildAssignmentEvidenceLines(assignments, { maxAssignments: 2 });

    // De Director moet kunnen zien dat dit de vierde en vijfde poging zijn,
    // niet de eerste en tweede — anders lijkt een vastgelopen lus op een
    // verse start.
    expect(lines).toContain('4. rol=builder, status=COMPLETED, opdracht="Opdracht 4"');
    expect(lines).toContain('5. rol=builder, status=COMPLETED, opdracht="Opdracht 5"');
  });

  it("kort een te lange samenvatting in en zegt dat erbij", () => {
    const lines = buildAssignmentEvidenceLines(
      [makeAssignment({ resultSummary: "x".repeat(500) })],
      { maxSummaryChars: 100 },
    );

    expect(lines).toContain("tekens ingekort");
    expect(lines.length).toBeLessThan(400);
  });
});

describe("formatPullRequestEvidence", () => {
  const base: PullRequestEvidence = {
    number: 58,
    title: "Voeg formatCents toe",
    url: "https://github.com/x/y/pull/58",
    state: "open",
    merged: false,
    headSha: "abcdef1234567890",
    ci: { state: "success", failingCheckNames: [], pendingCheckNames: [] },
    changedFiles: [{ filename: "src/utils/formatCents.ts", status: "added" }],
    omittedFileCount: 0,
  };

  it("zegt het eerlijk wanneer er geen bewijs is", () => {
    expect(formatPullRequestEvidence(null)).toContain("Nog geen pull request gevonden");
  });

  it("toont nummer, status en de commit waaraan het bewijs gepind is", () => {
    const text = formatPullRequestEvidence(base);

    expect(text).toContain("#58");
    expect(text).toContain("OPEN");
    expect(text).toContain("abcdef1");
    expect(text).toContain("src/utils/formatCents.ts");
  });

  it("toont GEMERGED wanneer de pull request gemerged is", () => {
    expect(formatPullRequestEvidence({ ...base, merged: true })).toContain("GEMERGED");
  });

  it("noemt een falende check bij naam", () => {
    const text = formatPullRequestEvidence({
      ...base,
      ci: {
        state: "failure",
        failingCheckNames: ["CI / Typecheck & import-check"],
        pendingCheckNames: [],
      },
    });

    expect(text).toContain("GEFAALD");
    expect(text).toContain("CI / Typecheck & import-check");
  });

  it("meldt dat de CI nog loopt", () => {
    const text = formatPullRequestEvidence({
      ...base,
      ci: { state: "pending", failingCheckNames: [], pendingCheckNames: ["CI / Tests"] },
    });

    expect(text).toContain("loopt nog");
    expect(text).toContain("CI / Tests");
  });

  it("meldt hoeveel bestanden niet bij naam genoemd zijn", () => {
    expect(
      formatPullRequestEvidence({ ...base, omittedFileCount: 3 }),
    ).toContain("nog 3 bestanden");
  });
});

describe("gatherPullRequestEvidence", () => {
  it("doet geen enkele GitHub-aanroep zolang er nog geen toewijzing is", async () => {
    const result = await gatherPullRequestEvidence(makeMission([]));

    expect(result).toBeNull();
    expect(mockedList).not.toHaveBeenCalled();
    expect(mockedTarget).not.toHaveBeenCalled();
  });

  it("geeft null terug wanneer er geen pull request bij de missie hoort", async () => {
    mockedTarget.mockReturnValue({ owner: "x", repo: "y" } as never);
    mockedList.mockResolvedValue([]);
    mockedFind.mockReturnValue(null);

    expect(await gatherPullRequestEvidence(makeMission([makeAssignment()]))).toBeNull();
    expect(mockedChecks).not.toHaveBeenCalled();
  });

  it("verzamelt CI-status en gewijzigde bestanden bij de gevonden pull request", async () => {
    mockedTarget.mockReturnValue({ owner: "x", repo: "y" } as never);
    mockedList.mockResolvedValue([]);
    mockedFind.mockReturnValue({
      number: 58,
      headRef: "mission/mis-1",
      headSha: "abcdef1234567890",
      merged: false,
      state: "open",
      url: "https://github.com/x/y/pull/58",
      title: "Voeg formatCents toe",
    });
    mockedChecks.mockResolvedValue({
      state: "success",
      failingCheckNames: [],
      pendingCheckNames: [],
    });
    mockedFiles.mockResolvedValue([
      { filename: "src/utils/formatCents.ts", status: "added" },
      { filename: "src/utils/formatCents.test.ts", status: "added" },
    ]);

    const result = await gatherPullRequestEvidence(makeMission([makeAssignment()]));

    expect(result?.number).toBe(58);
    expect(result?.ci.state).toBe("success");
    expect(result?.changedFiles).toHaveLength(2);
    expect(result?.omittedFileCount).toBe(0);

    // De CI-status hoort bij de exacte commit, niet bij "de branch".
    expect(mockedChecks).toHaveBeenCalledWith(expect.anything(), "abcdef1234567890");
  });

  it("zet de missie niet stil wanneer GitHub onbereikbaar is", async () => {
    mockedTarget.mockReturnValue({ owner: "x", repo: "y" } as never);
    mockedList.mockRejectedValue(new Error("GitHub is onbereikbaar."));

    // Fail-open: geen exception, gewoon minder bewijs. Een storing bij GitHub
    // mag nooit betekenen dat een missie blijft liggen.
    await expect(
      gatherPullRequestEvidence(makeMission([makeAssignment()])),
    ).resolves.toBeNull();
  });
});
