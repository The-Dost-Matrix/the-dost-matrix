import { describe, expect, it } from "vitest";

import type { MissionV2 } from "./mission";
import {
  MAX_TECHNICAL_REPAIR_ATTEMPTS,
  TECHNICAL_REPAIR_KIND,
  buildTechnicalRepairExhaustedMessage,
  buildTechnicalRepairObjective,
  buildTechnicalRepairReason,
  countTechnicalRepairAttempts,
  hasExhaustedTechnicalRepair,
} from "./technical-repair";

type Assignment = MissionV2["assignments"][number];

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    assignmentId: "assignment-1",
    decisionId: "decision-1",
    roleId: "builder",
    status: "COMPLETED",
    objective: "Iets bouwen",
    successCriteria: [],
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    ...overrides,
  };
}

function mission(assignments: Assignment[]): MissionV2 {
  return { assignments } as unknown as MissionV2;
}

describe("countTechnicalRepairAttempts", () => {
  it("telt alleen toewijzingen die als herstelpoging zijn vastgelegd", () => {
    const counted = countTechnicalRepairAttempts(
      mission([
        assignment({ assignmentId: "a1" }),
        assignment({ assignmentId: "a2", kind: TECHNICAL_REPAIR_KIND }),
        assignment({ assignmentId: "a3", roleId: "qa" }),
        assignment({ assignmentId: "a4", kind: TECHNICAL_REPAIR_KIND }),
      ]),
    );

    expect(counted).toBe(2);
  });

  it("telt oudere toewijzingen zonder dit veld als geen herstelpoging", () => {
    expect(countTechnicalRepairAttempts(mission([assignment(), assignment()]))).toBe(0);
  });

  it("geeft nul bij een missie zonder toewijzingen", () => {
    expect(countTechnicalRepairAttempts(mission([]))).toBe(0);
  });

  it("laat zich niet misleiden door een opdrachttekst die op herstel lijkt", () => {
    const counted = countTechnicalRepairAttempts(
      mission([assignment({ objective: "HERSTELOPDRACHT (poging 1 van 3)." })]),
    );

    expect(counted).toBe(0);
  });
});

describe("hasExhaustedTechnicalRepair", () => {
  const repairs = (count: number) =>
    mission(
      Array.from({ length: count }, (_, index) =>
        assignment({ assignmentId: `a${index}`, kind: TECHNICAL_REPAIR_KIND }),
      ),
    );

  it("is onwaar zolang het plafond niet is bereikt", () => {
    expect(hasExhaustedTechnicalRepair(repairs(0))).toBe(false);
    expect(hasExhaustedTechnicalRepair(repairs(MAX_TECHNICAL_REPAIR_ATTEMPTS - 1))).toBe(false);
  });

  it("is waar zodra het plafond is bereikt", () => {
    expect(hasExhaustedTechnicalRepair(repairs(MAX_TECHNICAL_REPAIR_ATTEMPTS))).toBe(true);
  });

  it("is waar wanneer het plafond zou zijn overschreden", () => {
    expect(hasExhaustedTechnicalRepair(repairs(MAX_TECHNICAL_REPAIR_ATTEMPTS + 1))).toBe(true);
  });

  it("respecteert een eigen plafond", () => {
    expect(hasExhaustedTechnicalRepair(repairs(1), 1)).toBe(true);
    expect(hasExhaustedTechnicalRepair(repairs(1), 2)).toBe(false);
  });
});

describe("buildTechnicalRepairObjective", () => {
  const base = {
    attempt: 1,
    maxAttempts: 3,
    pullRequestNumber: 41,
    changedFilePaths: ["src/core/x.ts", "src/core/x.test.ts"],
    failureReport: "Gefaalde controle: CI / Typecheck\nsrc/core/x.ts(3,1): error TS2304",
  };

  it("noemt de hoeveelste poging dit is", () => {
    expect(buildTechnicalRepairObjective({ ...base, attempt: 2 })).toContain("poging 2 van 3");
  });

  it("noemt het nummer van de pull request", () => {
    expect(buildTechnicalRepairObjective(base)).toContain("#41");
  });

  it("somt de tot nu toe gewijzigde bestanden op", () => {
    const objective = buildTechnicalRepairObjective(base);

    expect(objective).toContain("- src/core/x.ts");
    expect(objective).toContain("- src/core/x.test.ts");
  });

  it("zegt het expliciet wanneer GitHub geen gewijzigde bestanden gaf", () => {
    const objective = buildTechnicalRepairObjective({ ...base, changedFilePaths: [] });

    expect(objective).toContain("geen gewijzigde bestanden");
  });

  it("neemt de volledige foutmelding letterlijk op", () => {
    expect(buildTechnicalRepairObjective(base)).toContain("error TS2304");
  });

  it("verbiedt het uitzetten van tests of controles om de CI groen te krijgen", () => {
    const objective = buildTechnicalRepairObjective(base);

    expect(objective).toContain("Zet nooit een test, controle of typecontrole uit");
    expect(objective).toContain("telt als mislukt");
  });

  it("verbiedt het verzinnen van namen en importpaden", () => {
    expect(buildTechnicalRepairObjective(base)).toContain("verzin niets");
  });
});

describe("buildTechnicalRepairReason", () => {
  it("noemt de gefaalde controles, de poging en dat dit een vaste regel is", () => {
    const reason = buildTechnicalRepairReason({
      attempt: 1,
      maxAttempts: 3,
      pullRequestNumber: 41,
      failingCheckNames: ["CI / Typecheck & import-check"],
    });

    expect(reason).toContain("CI / Typecheck & import-check");
    expect(reason).toContain("herstelpoging 1 van 3");
    expect(reason).toContain("vaste regel");
  });

  it("blijft leesbaar wanneer GitHub geen namen van controles gaf", () => {
    const reason = buildTechnicalRepairReason({
      attempt: 1,
      maxAttempts: 3,
      pullRequestNumber: 41,
      failingCheckNames: [],
    });

    expect(reason).toContain("onbekende controle");
  });
});

describe("buildTechnicalRepairExhaustedMessage", () => {
  it("noemt het aantal pogingen, de reden om te stoppen en de pull request", () => {
    const message = buildTechnicalRepairExhaustedMessage(3, 41, "https://github.com/x/y/pull/41", [
      "CI / Typecheck & import-check",
    ]);

    expect(message).toContain("3 automatische herstelpogingen");
    expect(message).toContain("CI / Typecheck & import-check");
    expect(message).toContain("https://github.com/x/y/pull/41");
    expect(message).toContain("stopt hier bewust");
  });
});
