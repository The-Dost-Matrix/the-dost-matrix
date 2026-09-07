import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * project-signals.ts is de laag die ophaalt; alles wat het aanroept wordt
 * hier vervangen. Dezelfde opzet als
 * director-runtime.ensureMissionPullRequestMerged.test.ts: de mockfabriek
 * inline met `vi.fn()`, en daarna de gemockte functie gewoon importeren en
 * met `vi.mocked()` besturen. Een `const` buiten de fabriek aanroepen zou
 * stuklopen, omdat vi.mock naar boven wordt gehesen en de fabriek dan draait
 * voordat die const bestaat.
 */
vi.mock("@/core/mission-engine/v2/github/github-client", () => ({
  getGithubRepoTarget: vi.fn(),
  listPullRequests: vi.fn(),
  getLatestCommitForPath: vi.fn(),
  countCommitsSince: vi.fn(),
}));

vi.mock("@/core/repositories/knowledge-repository", () => ({
  getKnowledgeEntries: vi.fn(),
}));

import {
  countCommitsSince,
  getGithubRepoTarget,
  getLatestCommitForPath,
  listPullRequests,
} from "@/core/mission-engine/v2/github/github-client";
import { getKnowledgeEntries } from "@/core/repositories/knowledge-repository";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

import {
  ROADMAP_PATH,
  collectProjectSignals,
  fetchOpenPullRequests,
  fetchPendingKnowledgeCount,
  fetchRoadmapFreshness,
} from "./project-signals";

const TARGET = { owner: "The-Dost-Matrix", repo: "the-dost-matrix" };

/**
 * getKnowledgeEntries geeft volledige KnowledgeEntry-objecten terug, maar
 * fetchPendingKnowledgeCount leest daar alleen `status` van. Een compleet
 * item nabouwen zou hier alleen ruis toevoegen — vandaar deze cast, in
 * dezelfde geest als buildMission() in mission-labels.test.ts.
 */
function entriesWithStatus(...statuses: (string | undefined)[]): KnowledgeEntry[] {
  return statuses.map((status) => ({ status }) as unknown as KnowledgeEntry);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGithubRepoTarget).mockReturnValue(TARGET);
});

describe("fetchOpenPullRequests", () => {
  it("vraagt alleen de openstaande pull requests op", async () => {
    vi.mocked(listPullRequests).mockResolvedValue([]);

    await fetchOpenPullRequests();

    expect(listPullRequests).toHaveBeenCalledWith(TARGET, "open");
  });

  it("houdt nummer, titel en aanmaakdatum over", async () => {
    vi.mocked(listPullRequests).mockResolvedValue([
      {
        number: 48,
        title: "Stap 12",
        createdAt: "2026-09-01T12:00:00.000Z",
        headRef: "x",
        headSha: "y",
        merged: false,
        state: "open",
        url: "https://example.invalid",
      },
    ]);

    expect(await fetchOpenPullRequests()).toEqual([
      { number: 48, title: "Stap 12", createdAt: "2026-09-01T12:00:00.000Z" },
    ]);
  });

  it("zet een ontbrekende aanmaakdatum om in null, niet in undefined", async () => {
    vi.mocked(listPullRequests).mockResolvedValue([
      {
        number: 7,
        title: "Zonder datum",
        headRef: "x",
        headSha: "y",
        merged: false,
        state: "open",
        url: "https://example.invalid",
      },
    ]);

    expect(await fetchOpenPullRequests()).toEqual([
      { number: 7, title: "Zonder datum", createdAt: null },
    ]);
  });

  it("geeft null bij een fout, zodat het verschil met 'niets open' bewaard blijft", async () => {
    vi.mocked(listPullRequests).mockRejectedValue(new Error("GitHub onbereikbaar"));

    expect(await fetchOpenPullRequests()).toBeNull();
  });
});

describe("fetchPendingKnowledgeCount", () => {
  it("telt alleen de items met status pending", async () => {
    vi.mocked(getKnowledgeEntries).mockResolvedValue(
      entriesWithStatus("pending", "approved", "pending", "rejected", undefined),
    );

    expect(await fetchPendingKnowledgeCount("owner-1")).toBe(2);
  });

  it("geeft nul terug wanneer er niets wacht", async () => {
    vi.mocked(getKnowledgeEntries).mockResolvedValue(entriesWithStatus("approved"));

    expect(await fetchPendingKnowledgeCount("owner-1")).toBe(0);
  });

  it("geeft null bij een fout", async () => {
    vi.mocked(getKnowledgeEntries).mockRejectedValue(new Error("Firestore weg"));

    expect(await fetchPendingKnowledgeCount("owner-1")).toBeNull();
  });
});

describe("fetchRoadmapFreshness", () => {
  it("telt de commits vanaf het tijdstip van de laatste roadmapwijziging", async () => {
    vi.mocked(getLatestCommitForPath).mockResolvedValue({
      sha: "abc",
      committedAt: "2026-09-05T09:00:00.000Z",
    });
    vi.mocked(countCommitsSince).mockResolvedValue({ count: 4, capped: false });

    expect(await fetchRoadmapFreshness()).toEqual({
      lastUpdatedIso: "2026-09-05T09:00:00.000Z",
      commitsSince: 4,
      capped: false,
    });

    expect(getLatestCommitForPath).toHaveBeenCalledWith(TARGET, ROADMAP_PATH);
    expect(countCommitsSince).toHaveBeenCalledWith(TARGET, "2026-09-05T09:00:00.000Z");
  });

  it("geeft null wanneer er geen commit voor de roadmap gevonden wordt", async () => {
    vi.mocked(getLatestCommitForPath).mockResolvedValue(null);

    expect(await fetchRoadmapFreshness()).toBeNull();
    expect(countCommitsSince).not.toHaveBeenCalled();
  });

  it("geeft null bij een fout", async () => {
    vi.mocked(getLatestCommitForPath).mockRejectedValue(new Error("GitHub onbereikbaar"));

    expect(await fetchRoadmapFreshness()).toBeNull();
  });
});

describe("collectProjectSignals", () => {
  it("bundelt de drie signalen", async () => {
    vi.mocked(listPullRequests).mockResolvedValue([
      {
        number: 1,
        title: "Open",
        headRef: "x",
        headSha: "y",
        merged: false,
        state: "open",
        url: "https://example.invalid",
      },
    ]);
    vi.mocked(getKnowledgeEntries).mockResolvedValue(entriesWithStatus("pending"));
    vi.mocked(getLatestCommitForPath).mockResolvedValue({
      sha: "a",
      committedAt: "2026-09-05T09:00:00.000Z",
    });
    vi.mocked(countCommitsSince).mockResolvedValue({ count: 0, capped: false });

    expect(await collectProjectSignals("owner-1")).toEqual({
      openPullRequests: [{ number: 1, title: "Open", createdAt: null }],
      pendingKnowledgeCount: 1,
      roadmapFreshness: {
        lastUpdatedIso: "2026-09-05T09:00:00.000Z",
        commitsSince: 0,
        capped: false,
      },
    });
  });

  it("laat één mislukt onderdeel de andere twee niet meeslepen", async () => {
    vi.mocked(listPullRequests).mockRejectedValue(new Error("GitHub onbereikbaar"));
    vi.mocked(getKnowledgeEntries).mockResolvedValue(entriesWithStatus("pending", "pending"));
    vi.mocked(getLatestCommitForPath).mockResolvedValue({
      sha: "a",
      committedAt: "2026-09-05T09:00:00.000Z",
    });
    vi.mocked(countCommitsSince).mockResolvedValue({ count: 3, capped: false });

    const signals = await collectProjectSignals("owner-1");

    expect(signals.openPullRequests).toBeNull();
    expect(signals.pendingKnowledgeCount).toBe(2);
    expect(signals.roadmapFreshness?.commitsSince).toBe(3);
  });

  it("gooit nooit, ook niet wanneer alles mislukt", async () => {
    vi.mocked(listPullRequests).mockRejectedValue(new Error("weg"));
    vi.mocked(getKnowledgeEntries).mockRejectedValue(new Error("weg"));
    vi.mocked(getLatestCommitForPath).mockRejectedValue(new Error("weg"));

    await expect(collectProjectSignals("owner-1")).resolves.toEqual({
      openPullRequests: null,
      pendingKnowledgeCount: null,
      roadmapFreshness: null,
    });
  });
});
