import { describe, expect, it } from "vitest";

import {
  derivePullRequestState,
  needsAttention,
  selectMissionPullRequest,
  type MissionPullRequestStatus,
} from "./mission-pr-status";

/**
 * Tests bij stap 19.
 *
 * Het ophalen zelf staat hier niet in — dat is vier GitHub-aanroepen met
 * fail-open eromheen, en dat is elders al gedekt. Wat hier wél in staat zijn de
 * drie beslissingen die de UI daadwerkelijk sturen: welke pull request bij deze
 * missie hoort, in welke toestand hij is, en of de eigenaar ernaar moet kijken.
 */

const MISSION_ID = "998c06aa-87c8-4dd1-a3f0-f2705da27c43";
const PREFIX = `director/mission-${MISSION_ID.slice(0, 8)}-`;

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 63,
    headRef: `${PREFIX}work`,
    headSha: "abc123",
    merged: false,
    state: "open",
    url: "https://github.com/x/y/pull/63",
    title: "Missie",
    ...overrides,
  } as never;
}

function status(overrides: Partial<MissionPullRequestStatus> = {}): MissionPullRequestStatus {
  return {
    number: 63,
    url: "https://github.com/x/y/pull/63",
    title: "Missie",
    state: "OPEN",
    ci: { state: "success", failingCheckNames: [], pendingCheckNames: [] },
    behindBy: 0,
    changedFilePaths: [],
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("selectMissionPullRequest", () => {
  it("vindt de pull request van deze missie", () => {
    expect(selectMissionPullRequest([pullRequest()], MISSION_ID)?.number).toBe(63);
  });

  it("negeert de pull request van een andere missie", () => {
    const other = pullRequest({ headRef: "director/mission-deadbeef-work" });

    expect(selectMissionPullRequest([other], MISSION_ID)).toBeNull();
  });

  it("neemt de hoogste nummer bij meerdere branches van dezelfde missie", () => {
    // Oudere missies hebben nog tijdstempel-branches met dezelfde prefix.
    const oud = pullRequest({ number: 12, headRef: `${PREFIX}20260901` });

    expect(selectMissionPullRequest([oud, pullRequest()], MISSION_ID)?.number).toBe(63);
  });

  it("geeft null wanneer er nog niets is", () => {
    // De normale stand van elke missie vóór de eerste builder-stap.
    expect(selectMissionPullRequest([], MISSION_ID)).toBeNull();
  });
});

describe("derivePullRequestState", () => {
  it("noemt een open pull request open", () => {
    expect(derivePullRequestState({ merged: false, state: "open" })).toBe("OPEN");
  });

  /**
   * De belangrijkste van de drie: GitHub noemt een gemergede pull request óók
   * "closed". "GESLOTEN" tonen op werk dat gewoon binnen is, is precies de
   * verwarring die deze stap moet wegnemen.
   */
  it("laat merged voorgaan op closed", () => {
    expect(derivePullRequestState({ merged: true, state: "closed" })).toBe("MERGED");
  });

  it("herkent een gesloten pull request zonder merge", () => {
    expect(derivePullRequestState({ merged: false, state: "closed" })).toBe("CLOSED");
  });
});

describe("needsAttention", () => {
  it("vraagt aandacht bij een rode CI", () => {
    expect(
      needsAttention(
        status({ ci: { state: "failure", failingCheckNames: ["CI"], pendingCheckNames: [] } }),
      ),
    ).toBe(true);
  });

  it("vraagt aandacht bij een achterlopende branch", () => {
    // Dit is twee keer op één avond de reden geweest dat een missie stilviel.
    expect(needsAttention(status({ behindBy: 1 }))).toBe(true);
  });

  it("vraagt geen aandacht bij een groene CI en een bijgewerkte branch", () => {
    expect(needsAttention(status())).toBe(false);
  });

  /**
   * Bewust smal: een lopende CI is normaal, en "geen checks" of een
   * onbekende stand zeggen niets. Zou dat ook aandacht vragen, dan schreeuwt
   * de kaart op momenten dat er niets aan de hand is.
   */
  it("vraagt geen aandacht bij een lopende, ontbrekende of onbekende CI", () => {
    expect(
      needsAttention(
        status({ ci: { state: "pending", failingCheckNames: [], pendingCheckNames: ["CI"] } }),
      ),
    ).toBe(false);

    expect(
      needsAttention(status({ ci: { state: "none", failingCheckNames: [], pendingCheckNames: [] } })),
    ).toBe(false);

    expect(needsAttention(status({ ci: null, behindBy: null }))).toBe(false);
  });
});
