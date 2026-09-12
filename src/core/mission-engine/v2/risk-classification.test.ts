import { describe, expect, it } from "vitest";
import {
  classifyPullRequestRisk,
  classifyPullRequestRiskForMission,
  findHardEscalationReason,
} from "./risk-classification";
import type { PullRequestFileChange } from "./github/github-client";
import type { MissionRiskLevel } from "./mission";

/**
 * Test tegen de daadwerkelijke API: PullRequestFileChange gebruikt het veld
 * "filename" (niet "path"), classifyPullRequestRisk() geeft
 * { level: "auto-approve" | "needs-signoff", reason } terug (geen los
 * "riskLevel"-veld met LOW/MEDIUM/HIGH/CRITICAL — die schaal hoort bij de
 * MISSIE zelf, zie mission.ts, niet bij deze bestandsgebaseerde
 * classificatie), en classifyPullRequestRiskForMission() neemt het
 * missie-risiconiveau als kale string aan (geen { riskLevel: ... }-object).
 */
const added = (filename: string): PullRequestFileChange => ({ filename, status: "added" });
const removed = (filename: string): PullRequestFileChange => ({ filename, status: "removed" });

const isolatedAutoApproveFile: PullRequestFileChange[] = [added("src/utils/isolated-helper.ts")];

describe("classifyPullRequestRisk", () => {
  it("behandelt een lege bestandslijst als needs-signoff (risico is dan niet betrouwbaar in te schatten)", () => {
    const result = classifyPullRequestRisk([]);

    expect(result.level).toBe("needs-signoff");
  });

  it("vereist needs-signoff zodra meer dan één bestand tegelijk wijzigt", () => {
    const singleFileResult = classifyPullRequestRisk([added("src/utils/format.ts")]);
    const multipleFilesResult = classifyPullRequestRisk([
      added("src/utils/format.ts"),
      added("src/utils/parse.ts"),
    ]);

    expect(singleFileResult.level).toBe("auto-approve");
    expect(multipleFilesResult.level).toBe("needs-signoff");
  });

  it("markeert een verwijderd bestand als needs-signoff", () => {
    const result = classifyPullRequestRisk([removed("src/utils/legacy.ts")]);

    expect(result.level).toBe("needs-signoff");
  });

  it("markeert een bestand op een kritiek pad als needs-signoff", () => {
    const result = classifyPullRequestRisk([added(".github/workflows/deploy.yml")]);

    expect(result.level).toBe("needs-signoff");
  });

  it("behandelt één geïsoleerd, niet-kritiek bestand als auto-approve", () => {
    const result = classifyPullRequestRisk(isolatedAutoApproveFile);

    expect(result.level).toBe("auto-approve");
  });
});

describe("classifyPullRequestRiskForMission", () => {
  it("laat de bestandsgebaseerde uitkomst ongewijzigd wanneer het missie-risiconiveau LOW is", () => {
    const baseline = classifyPullRequestRisk(isolatedAutoApproveFile);
    const withMission = classifyPullRequestRiskForMission(isolatedAutoApproveFile, "LOW");

    expect(withMission.level).toBe(baseline.level);
  });

  it.each(["MEDIUM", "HIGH", "CRITICAL"] as MissionRiskLevel[])(
    "vereist altijd needs-signoff wanneer het missie-risiconiveau %s is, ook voor een op zichzelf auto-approve bestand",
    (missionRiskLevel) => {
      const baseline = classifyPullRequestRisk(isolatedAutoApproveFile);
      expect(baseline.level).toBe("auto-approve");

      const withMission = classifyPullRequestRiskForMission(isolatedAutoApproveFile, missionRiskLevel);

      expect(withMission.level).toBe("needs-signoff");
    },
  );
});

describe("findHardEscalationReason (stap 15)", () => {
  it("geeft null terug voor een gewone, niet-gevoelige wijziging", () => {
    expect(findHardEscalationReason(isolatedAutoApproveFile)).toBeNull();
    expect(
      findHardEscalationReason([added("src/utils/format.ts"), added("src/utils/parse.ts")]),
    ).toBeNull();
  });

  it("escaleert altijd bij een verwijderd bestand, ongeacht welk bestand", () => {
    expect(findHardEscalationReason([removed("src/utils/legacy.ts")])).not.toBeNull();
  });

  it.each([
    ".github/workflows/deploy.yml",
    ".env.production",
    "src/lib/secret-rotation.ts",
    "src/lib/github-credential-store.ts",
    "src/core/service-account-loader.ts",
    "scripts/generate-private-key.ts",
    "src/core/firebase/admin.ts",
    "firestore.rules",
    "src/domains/auth/auth-provider.tsx",
  ])("escaleert altijd bij een gevoelig bestand: %s", (filename) => {
    expect(findHardEscalationReason([added(filename)])).not.toBeNull();
  });

  it("escaleert NIET voor een kritiek-maar-niet-gevoelig pad (bijvoorbeeld src/core/ zonder secrets/auth)", () => {
    // src/core/ staat wel op CRITICAL_PATH_PATTERNS (dus needs-signoff via
    // classifyPullRequestRisk), maar niet elk bestand daaronder is
    // per definitie een geheim of authenticatie — alleen de expliciet
    // gevoelige subpaden (firebase/, of "auth"/"secret"/"credential" in de
    // naam) escaleren hard. Dit bevestigt dat findHardEscalationReason een
    // striktere, kleinere set is dan CRITICAL_PATH_PATTERNS.
    expect(
      findHardEscalationReason([added("src/core/mission-engine/v2/mission.ts")]),
    ).toBeNull();
  });
});
