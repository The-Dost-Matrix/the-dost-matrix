import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * De GitHub-client wordt volledig gemockt: deze tests gaan over het
 * WACHTGEDRAG — wanneer wordt er doorgegaan, wanneer wordt er gestopt — en
 * niet over het HTTP-verkeer, dat elders (github-client.test.ts) gedekt is.
 *
 * De klok en het wachten zelf worden geïnjecteerd, zodat een test die een
 * tijdslimiet aftast niet daadwerkelijk minuten hoeft te duren.
 */
vi.mock("./github/github-client", () => ({
  getGithubRepoTarget: vi.fn(() => ({ owner: "The-Dost-Matrix", repo: "the-dost-matrix" })),
  listPullRequests: vi.fn(),
  getCombinedCheckStatus: vi.fn(),
}));

import { getCombinedCheckStatus, listPullRequests } from "./github/github-client";
import { CI_POLL_INTERVAL_MS, MAX_CI_WAIT_MS, waitForMissionChecks } from "./ci-wait";

const MISSION_ID = "998c06aa-87c8-4dd1-a3f0-f2705da27c43";

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: 62,
    headRef: `director/mission-${MISSION_ID.slice(0, 8)}-work`,
    headSha: "abc123",
    merged: false,
    state: "open",
    url: "https://github.com/x/y/pull/62",
    title: "Missie",
    ...overrides,
  } as never;
}

function checkStatus(state: string) {
  return { state, failingCheckNames: [], pendingCheckNames: [] } as never;
}

/**
 * Een klok die alleen vooruit gaat wanneer er "gewacht" wordt. Zo is het
 * verstrijken van tijd in deze tests volledig bepaald door het aantal
 * wachtrondes, en niet door hoe snel de testrunner is.
 */
function fakeClock(startAt = 1_000_000) {
  let current = startAt;

  return {
    now: () => current,
    wait: async (ms: number) => {
      current += ms;
    },
  };
}

describe("waitForMissionChecks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("geeft SETTLED zodra de CI geslaagd is", async () => {
    vi.mocked(listPullRequests).mockResolvedValue([pullRequest()]);
    vi.mocked(getCombinedCheckStatus).mockResolvedValue(checkStatus("success"));

    const clock = fakeClock();
    const outcome = await waitForMissionChecks(MISSION_ID, {
      deadlineAt: clock.now() + 600_000,
      ...clock,
    });

    expect(outcome).toBe("SETTLED");
  });

  it("geeft óók SETTLED bij een rode CI", async () => {
    // Wat er met rood moet gebeuren, beslist de Director (de technische
    // herstellus). Deze functie stelt alleen vast dát er een uitkomst is.
    vi.mocked(listPullRequests).mockResolvedValue([pullRequest()]);
    vi.mocked(getCombinedCheckStatus).mockResolvedValue(checkStatus("failure"));

    const clock = fakeClock();

    expect(
      await waitForMissionChecks(MISSION_ID, { deadlineAt: clock.now() + 600_000, ...clock }),
    ).toBe("SETTLED");
  });

  it("blijft wachten zolang de checks nog lopen, en geeft daarna SETTLED", async () => {
    vi.mocked(listPullRequests).mockResolvedValue([pullRequest()]);
    vi.mocked(getCombinedCheckStatus)
      .mockResolvedValueOnce(checkStatus("pending"))
      .mockResolvedValueOnce(checkStatus("pending"))
      .mockResolvedValueOnce(checkStatus("success"));

    const clock = fakeClock();
    const outcome = await waitForMissionChecks(MISSION_ID, {
      deadlineAt: clock.now() + 600_000,
      ...clock,
    });

    expect(outcome).toBe("SETTLED");
    expect(getCombinedCheckStatus).toHaveBeenCalledTimes(3);
  });

  /**
   * De belangrijkste test van dit bestand. "none" betekent dat GitHub nog
   * geen enkele check-run heeft geregistreerd — precies de toestand vlak na
   * een push waar de hele pauze voor bestaat. Zou die als "klaar" tellen, dan
   * was de bug van 14 september in één klap terug.
   */
  it("telt 'geen check-runs' niet als klaar", async () => {
    vi.mocked(listPullRequests).mockResolvedValue([pullRequest()]);
    vi.mocked(getCombinedCheckStatus).mockResolvedValue(checkStatus("none"));

    const clock = fakeClock();
    const outcome = await waitForMissionChecks(MISSION_ID, {
      deadlineAt: clock.now() + 600_000,
      ...clock,
    });

    expect(outcome).toBe("TIMED_OUT");
  });

  it("stopt met wachten binnen de eigen tijdsgrens", async () => {
    vi.mocked(listPullRequests).mockResolvedValue([pullRequest()]);
    vi.mocked(getCombinedCheckStatus).mockResolvedValue(checkStatus("pending"));

    const clock = fakeClock();
    const startedAt = clock.now();

    await waitForMissionChecks(MISSION_ID, { deadlineAt: startedAt + 600_000, ...clock });

    expect(clock.now() - startedAt).toBeLessThanOrEqual(MAX_CI_WAIT_MS);
    expect(clock.now() - startedAt).toBeGreaterThanOrEqual(MAX_CI_WAIT_MS - CI_POLL_INTERVAL_MS);
  });

  it("wacht helemaal niet wanneer de aanroep zelf bijna om is", async () => {
    // Anders zou het wachten de laatste seconden opeten en zou er daarna geen
    // tijd meer zijn om überhaupt een stap te zetten.
    vi.mocked(listPullRequests).mockResolvedValue([pullRequest()]);

    const clock = fakeClock();
    const outcome = await waitForMissionChecks(MISSION_ID, {
      deadlineAt: clock.now() + 10_000,
      ...clock,
    });

    expect(outcome).toBe("TIMED_OUT");
    expect(listPullRequests).not.toHaveBeenCalled();
  });

  it("geeft NO_PULL_REQUEST wanneer er niets te wachten valt", async () => {
    vi.mocked(listPullRequests).mockResolvedValue([]);

    const clock = fakeClock();

    expect(
      await waitForMissionChecks(MISSION_ID, { deadlineAt: clock.now() + 600_000, ...clock }),
    ).toBe("NO_PULL_REQUEST");
  });

  it("negeert een pull request van een andere missie", async () => {
    vi.mocked(listPullRequests).mockResolvedValue([
      pullRequest({ headRef: "director/mission-deadbeef-work" }),
    ]);

    const clock = fakeClock();

    expect(
      await waitForMissionChecks(MISSION_ID, { deadlineAt: clock.now() + 600_000, ...clock }),
    ).toBe("NO_PULL_REQUEST");
  });

  it("geeft ERROR wanneer GitHub onbereikbaar is", async () => {
    // Niet doorgaan: doorgaan zou betekenen dat er weer geoordeeld wordt op
    // een onbekende CI-stand.
    vi.mocked(listPullRequests).mockRejectedValue(new Error("GitHub onbereikbaar"));

    const clock = fakeClock();

    expect(
      await waitForMissionChecks(MISSION_ID, { deadlineAt: clock.now() + 600_000, ...clock }),
    ).toBe("ERROR");
  });
});
