import { describe, expect, it } from "vitest";
import {
  ensureMissionPullRequestMerged,
  MissionSignoffRequiredError,
} from "./director-runtime";

describe("MissionSignoffRequiredError", () => {
  it("is een gewone Error met een machineleesbaar 'NEEDS_SIGNOFF' foutcode-veld", () => {
    const message =
      "De pull request van deze missie is nog niet gemerged. risicoclassificatie: needs-signoff — een mens moet deze pull request expliciet goedkeuren en mergen voordat de missie als voltooid kan worden gemarkeerd.";

    const error = new MissionSignoffRequiredError(message);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(MissionSignoffRequiredError);
    expect(error.name).toBe("MissionSignoffRequiredError");
    expect(error.code).toBe("NEEDS_SIGNOFF");
    // De mensleesbare boodschap moet exact bewaard blijven, inclusief de
    // historische marker-tekst waar de UI voorheen op zocht.
    expect(error.message).toBe(message);
    expect(error.message).toContain("risicoclassificatie: needs-signoff");
  });

  it("blijft herkenbaar als 'gewone' Error voor generieke foutafhandeling (bijv. logging)", () => {
    const error = new MissionSignoffRequiredError("needs-signoff scenario");

    // Ook zonder specifieke instanceof-check moet de fout zich als Error
    // gedragen (stack, message, etc.), zodat bestaande catch-blokken die
    // simpelweg `error instanceof Error` doen niet breken.
    expect(typeof error.message).toBe("string");
    expect(typeof error.stack).toBe("string");
  });
});

describe("ensureMissionPullRequestMerged", () => {
  it("gooit een MissionSignoffRequiredError met code NEEDS_SIGNOFF wanneer de pull request nog niet is gemerged en de missie als needs-signoff is geclassificeerd", async () => {
    const pullRequest = {
      number: 101,
      merged: false,
      url: "https://github.com/example/example/pull/101",
    };

    let caught: unknown;

    try {
      await ensureMissionPullRequestMerged({
        pullRequest,
        riskClassification: "needs-signoff",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MissionSignoffRequiredError);

    const signoffError = caught as MissionSignoffRequiredError;
    expect(signoffError.code).toBe("NEEDS_SIGNOFF");
    expect(signoffError.message).toContain("risicoclassificatie: needs-signoff");
  });

  it("gooit geen MissionSignoffRequiredError wanneer de pull request al is gemerged", async () => {
    const pullRequest = {
      number: 202,
      merged: true,
      url: "https://github.com/example/example/pull/202",
    };

    await expect(
      ensureMissionPullRequestMerged({
        pullRequest,
        riskClassification: "needs-signoff",
      }),
    ).resolves.not.toThrow();
  });
});