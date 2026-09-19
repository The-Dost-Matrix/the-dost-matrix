import { describe, it, expect } from "vitest";
import {
  formatDurationNl,
  getAssignmentDurationMs,
  getMissionDurationMs,
} from "./mission-duration";
import type { MissionAssignmentRecord, MissionV2 } from "./mission";

const nowMs = Date.parse("2026-09-13T17:00:00.000Z");

function buildMission(overrides: Partial<MissionV2> = {}): MissionV2 {
  return {
    missionId: "mission-duration",
    ownerId: "owner-1",
    projectId: "project-1",
    goalRefs: ["goal-1"],
    title: "Missieduur zichtbaar maken",
    objective: "Doorlooptijden deterministisch berekenen.",
    status: "ACTIVE",
    priority: 1,
    riskLevel: "LOW",
    budget: { maximumCost: 10, currency: "EUR" },
    spentCost: 0,
    successCriteria: [
      {
        criterionId: "criterion-1",
        description: "De doorlooptijden zijn getest.",
        status: "PENDING",
        evidenceRefs: [],
      },
    ],
    constraints: [],
    assignments: [],
    activeAssignmentIds: [],
    ownerApprovalState: "NOT_REQUIRED",
    version: 1,
    createdAt: "2026-09-13T08:00:00.000Z",
    updatedAt: "2026-09-13T08:00:00.000Z",
    ...overrides,
  };
}

const assignment: MissionAssignmentRecord = {
  assignmentId: "assignment-1",
  decisionId: "decision-1",
  roleId: "builder",
  status: "ACTIVE",
  objective: "De rekenlaag toevoegen.",
  successCriteria: ["De rekenlaag heeft unit tests."],
  createdAt: "2026-09-13T08:15:00.000Z",
  updatedAt: "2026-09-13T08:15:00.000Z",
};

describe("getMissionDurationMs", () => {
  it("telt negen uur stilstand mee vanaf createdAt tot het expliciete nu", () => {
    const mission = buildMission();

    expect(getMissionDurationMs(mission, nowMs)).toBe(32_400_000);
    expect(getMissionDurationMs(mission, nowMs + 60_000)).toBe(32_460_000);
  });

  it("eindigt bij completedAt en negeert latere wijzigingen en het nu-tijdstip", () => {
    const mission = buildMission({
      status: "COMPLETED",
      completedAt: "2026-09-13T10:15:00.000Z",
      updatedAt: "2026-09-13T16:00:00.000Z",
      successCriteria: [
        {
          criterionId: "criterion-1",
          description: "De doorlooptijden zijn getest.",
          status: "PASSED",
          evidenceRefs: ["evidence-1"],
        },
      ],
    });

    expect(getMissionDurationMs(mission, nowMs)).toBe(8_100_000);
    expect(getMissionDurationMs(mission, nowMs + 60_000)).toBe(8_100_000);
    expect(
      getMissionDurationMs(mission, Date.parse("2026-09-13T09:00:00.000Z")),
    ).toBe(8_100_000);
  });

  for (const status of ["PAUSED", "FAILED", "CANCELLED"] as const) {
    it(`blijft zonder completedAt doorlopen bij ${status}`, () => {
      const mission = buildMission({
        status,
        updatedAt: "2026-09-13T09:00:00.000Z",
      });

      expect(getMissionDurationMs(mission, nowMs)).toBe(32_400_000);
    });
  }

  it("geeft nul wanneer nu of completedAt vóór createdAt ligt", () => {
    expect(
      getMissionDurationMs(
        buildMission(),
        Date.parse("2026-09-13T07:59:59.000Z"),
      ),
    ).toBe(0);
    expect(
      getMissionDurationMs(
        buildMission({ completedAt: "2026-09-13T07:59:59.000Z" }),
        nowMs,
      ),
    ).toBe(0);
  });

  it("geeft nul wanneer nu gelijk is aan createdAt", () => {
    expect(
      getMissionDurationMs(
        buildMission(),
        Date.parse("2026-09-13T08:00:00.000Z"),
      ),
    ).toBe(0);
  });

  it("behoudt milliseconden zonder afronding", () => {
    expect(
      getMissionDurationMs(
        buildMission({ completedAt: "2026-09-13T08:00:00.042Z" }),
        nowMs,
      ),
    ).toBe(42);
  });

  it("wijst ongeldige gebruikte tijdstempels af", () => {
    expect(() =>
      getMissionDurationMs(buildMission({ createdAt: "ongeldig" }), nowMs),
    ).toThrow("mission.createdAt moet een geldig ISO-tijdstip zijn.");
    expect(() =>
      getMissionDurationMs(buildMission({ completedAt: "" }), nowMs),
    ).toThrow("mission.completedAt moet een geldig ISO-tijdstip zijn.");
  });

  it("leest updatedAt niet als eindtijd of als vereiste tijdstempel", () => {
    expect(
      getMissionDurationMs(buildMission({ updatedAt: "ongeldig" }), nowMs),
    ).toBe(32_400_000);
  });

  it("wijst een niet-eindig nu ook af wanneer completedAt aanwezig is", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => getMissionDurationMs(buildMission(), value)).toThrow(
        "nowMs moet een eindig aantal milliseconden zijn.",
      );
      expect(() =>
        getMissionDurationMs(
          buildMission({ completedAt: "2026-09-13T10:15:00.000Z" }),
          value,
        ),
      ).toThrow("nowMs moet een eindig aantal milliseconden zijn.");
    }
  });
});

describe("getAssignmentDurationMs", () => {
  it("laat een ACTIVE toewijzing vanaf createdAt doorlopen tot nu", () => {
    expect(getAssignmentDurationMs(assignment, nowMs)).toBe(31_500_000);
    expect(getAssignmentDurationMs(assignment, nowMs + 60_000)).toBe(31_560_000);
  });

  it("gebruikt updatedAt niet als eindtijd zolang de toewijzing ACTIVE is", () => {
    expect(
      getAssignmentDurationMs(
        { ...assignment, updatedAt: "2026-09-13T09:00:00.000Z" },
        nowMs,
      ),
    ).toBe(31_500_000);
    expect(
      getAssignmentDurationMs(
        { ...assignment, updatedAt: "ongeldig" },
        nowMs,
      ),
    ).toBe(31_500_000);
  });

  for (const status of [
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "WAITING_FOR_INPUT",
  ] as const) {
    it(`eindigt bij updatedAt wanneer het rolresultaat ${status} is`, () => {
      const result: MissionAssignmentRecord = {
        ...assignment,
        status,
        resultId: "result-1",
        updatedAt: "2026-09-13T08:22:00.000Z",
      };

      expect(getAssignmentDurationMs(result, nowMs)).toBe(420_000);
      expect(getAssignmentDurationMs(result, nowMs + 60_000)).toBe(420_000);
      expect(
        getAssignmentDurationMs(result, Date.parse(assignment.createdAt)),
      ).toBe(420_000);
    });
  }

  it("telt wachten op de eigenaar alleen mee in de missieduur", () => {
    const result: MissionAssignmentRecord = {
      ...assignment,
      status: "WAITING_FOR_INPUT",
      resultId: "result-1",
      updatedAt: "2026-09-13T08:22:00.000Z",
    };
    const mission = buildMission({
      status: "WAITING_FOR_OWNER",
      assignments: [result],
      updatedAt: result.updatedAt,
      pendingOwnerInput: {
        requestId: "input-1",
        question: "Welke uitvoer is gewenst?",
        requestedAt: result.updatedAt,
      },
    });

    expect(getMissionDurationMs(mission, nowMs)).toBe(32_400_000);
    expect(getAssignmentDurationMs(result, nowMs)).toBe(420_000);

    // recordOwnerInput hervat de missie, niet de afgesloten uitvoeringspoging.
    const resumedMission = buildMission({
      assignments: [result],
      updatedAt: "2026-09-13T16:00:00.000Z",
    });

    expect(getMissionDurationMs(resumedMission, nowMs)).toBe(32_400_000);
    expect(getAssignmentDurationMs(resumedMission.assignments[0], nowMs)).toBe(
      420_000,
    );
  });

  it("berekent afzonderlijke pogingen voor dezelfde rol zonder optelling", () => {
    const result: MissionAssignmentRecord = {
      ...assignment,
      status: "COMPLETED",
      resultId: "result-1",
      updatedAt: "2026-09-13T08:22:00.000Z",
    };
    const nextAssignment: MissionAssignmentRecord = {
      ...assignment,
      assignmentId: "assignment-2",
      decisionId: "decision-2",
      createdAt: "2026-09-13T16:00:00.000Z",
      updatedAt: "2026-09-13T16:00:00.000Z",
    };

    expect(getAssignmentDurationMs(result, nowMs)).toBe(420_000);
    expect(getAssignmentDurationMs(nextAssignment, nowMs)).toBe(3_600_000);
  });

  it("geeft nul voor een eindtijd vóór of gelijk aan createdAt", () => {
    expect(
      getAssignmentDurationMs(
        assignment,
        Date.parse("2026-09-13T08:14:59.000Z"),
      ),
    ).toBe(0);
    expect(
      getAssignmentDurationMs(assignment, Date.parse(assignment.createdAt)),
    ).toBe(0);
    expect(
      getAssignmentDurationMs(
        {
          ...assignment,
          status: "COMPLETED",
          updatedAt: "2026-09-13T08:14:59.000Z",
        },
        nowMs,
      ),
    ).toBe(0);
  });

  it("wijst ongeldige gebruikte tijdstempels af", () => {
    expect(() =>
      getAssignmentDurationMs({ ...assignment, createdAt: "ongeldig" }, nowMs),
    ).toThrow("assignment.createdAt moet een geldig ISO-tijdstip zijn.");
    expect(() =>
      getAssignmentDurationMs(
        { ...assignment, status: "COMPLETED", updatedAt: "ongeldig" },
        nowMs,
      ),
    ).toThrow("assignment.updatedAt moet een geldig ISO-tijdstip zijn.");
  });

  it("vereist een eindig nu voor actieve en afgesloten toewijzingen", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => getAssignmentDurationMs(assignment, value)).toThrow(
        "nowMs moet een eindig aantal milliseconden zijn.",
      );
      expect(() =>
        getAssignmentDurationMs(
          { ...assignment, status: "COMPLETED" },
          value,
        ),
      ).toThrow("nowMs moet een eindig aantal milliseconden zijn.");
    }
  });
});

describe("formatDurationNl", () => {
  it("toont de gevraagde voorbeelden voor seconden, minuten en uren", () => {
    expect(formatDurationNl(42_000)).toBe("42 seconden");
    expect(formatDurationNl(420_000)).toBe("7 minuten");
    expect(formatDurationNl(8_100_000)).toBe("2 uur 15 minuten");
  });

  it("gebruikt enkelvoud en laat nul resterende minuten weg", () => {
    expect(formatDurationNl(1_000)).toBe("1 seconde");
    expect(formatDurationNl(60_000)).toBe("1 minuut");
    expect(formatDurationNl(3_600_000)).toBe("1 uur");
    expect(formatDurationNl(3_660_000)).toBe("1 uur 1 minuut");
    expect(formatDurationNl(7_200_000)).toBe("2 uur");
  });

  it("rondt kleinere eenheden naar beneden af bij de eenheidsgrenzen", () => {
    expect(formatDurationNl(999)).toBe("0 seconden");
    expect(formatDurationNl(1_999)).toBe("1 seconde");
    expect(formatDurationNl(59_999)).toBe("59 seconden");
    expect(formatDurationNl(60_001)).toBe("1 minuut");
    expect(formatDurationNl(3_599_999)).toBe("59 minuten");
    expect(formatDurationNl(3_659_999)).toBe("1 uur");
    expect(formatDurationNl(8_159_999)).toBe("2 uur 15 minuten");
  });

  it("laat uren boven 24 doorlopen", () => {
    expect(formatDurationNl(90_060_000)).toBe("25 uur 1 minuut");
    expect(formatDurationNl(172_800_000)).toBe("48 uur");
  });

  it("toont nul seconden voor nul en negatieve duren", () => {
    expect(formatDurationNl(0)).toBe("0 seconden");
    expect(formatDurationNl(-1)).toBe("0 seconden");
    expect(formatDurationNl(-3_600_000)).toBe("0 seconden");
  });

  it("wijst niet-eindige duren af", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => formatDurationNl(value)).toThrow(
        "durationMs moet een eindig aantal milliseconden zijn.",
      );
    }
  });
});
