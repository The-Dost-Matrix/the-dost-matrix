import { describe, expect, it } from "vitest";

import {
  buildCriteriaPhase,
  buildMergePhase,
  buildPlanningPhase,
  deriveMissionPhases,
} from "./mission-progress";
import type { MissionV2 } from "./mission";

function buildMission(overrides: Record<string, unknown> = {}): MissionV2 {
  return {
    missionId: "m1",
    ownerId: "owner-1",
    title: "Testmissie",
    objective: "Iets opleveren.",
    status: "ACTIVE",
    riskLevel: "LOW",
    version: 1,
    successCriteria: [],
    assignments: [],
    constraints: [],
    ...overrides,
  } as unknown as MissionV2;
}

function assignment(roleId: string, status: string, id = `${roleId}-${status}`) {
  return { assignmentId: id, roleId, status, objective: "Doe iets.", successCriteria: [] };
}

describe("buildPlanningPhase", () => {
  it("staat op WACHT zolang de Director nog geen stap heeft gezet", () => {
    expect(buildPlanningPhase(buildMission({ status: "DRAFT" })).state).toBe("WACHT");
  });

  it("is KLAAR zodra er toewijzingen zijn, en noemt het aantal", () => {
    const phase = buildPlanningPhase(
      buildMission({ assignments: [assignment("builder", "COMPLETED")] }),
    );

    expect(phase.state).toBe("KLAAR");
    expect(phase.detail).toContain("1 toewijzing");
  });
});

describe("rolfases", () => {
  it("meldt een rol die nog niet is ingezet als WACHT, niet als klaar", () => {
    const phases = deriveMissionPhases(buildMission());
    const qa = phases.find((phase) => phase.id === "qa");

    expect(qa?.state).toBe("WACHT");
    expect(qa?.detail).toBe("Nog niet ingezet.");
  });

  it("toont een lopende builder-toewijzing als BEZIG", () => {
    const phases = deriveMissionPhases(
      buildMission({ assignments: [assignment("builder", "ACTIVE")] }),
    );

    expect(phases.find((phase) => phase.id === "builder")?.state).toBe("BEZIG");
  });

  it("kijkt naar de LAATSTE toewijzing van een rol en telt het totaal erbij", () => {
    const phases = deriveMissionPhases(
      buildMission({
        assignments: [
          assignment("builder", "COMPLETED", "b1"),
          assignment("builder", "ACTIVE", "b2"),
        ],
      }),
    );

    const builder = phases.find((phase) => phase.id === "builder");
    expect(builder?.state).toBe("BEZIG");
    expect(builder?.detail).toContain("2 toewijzingen");
  });

  it("vraagt aandacht bij een mislukte toewijzing", () => {
    const phases = deriveMissionPhases(
      buildMission({ assignments: [assignment("qa", "FAILED")] }),
    );

    expect(phases.find((phase) => phase.id === "qa")?.state).toBe("AANDACHT");
  });
});

describe("buildCriteriaPhase", () => {
  const criterion = (status: string, id: string) => ({
    criterionId: id,
    description: id,
    status,
    evidenceRefs: [],
  });

  it("telt hoeveel criteria daadwerkelijk zijn gehaald", () => {
    const phase = buildCriteriaPhase(
      buildMission({
        successCriteria: [criterion("PASSED", "c1"), criterion("PENDING", "c2")],
      }),
    );

    expect(phase.state).toBe("BEZIG");
    expect(phase.detail).toBe("1 van 2 gehaald.");
  });

  it("vraagt aandacht zodra één criterium is afgekeurd", () => {
    const phase = buildCriteriaPhase(
      buildMission({
        successCriteria: [criterion("PASSED", "c1"), criterion("FAILED", "c2")],
      }),
    );

    expect(phase.state).toBe("AANDACHT");
    expect(phase.detail).toContain("1 afgekeurd");
  });

  it("is pas KLAAR wanneer alle criteria zijn gehaald", () => {
    const phase = buildCriteriaPhase(
      buildMission({ successCriteria: [criterion("PASSED", "c1")] }),
    );

    expect(phase.state).toBe("KLAAR");
  });

  it("vraagt aandacht zodra QA een criterium niet kon vaststellen (stap 12b)", () => {
    const phase = buildCriteriaPhase(
      buildMission({
        successCriteria: [criterion("PASSED", "c1"), criterion("UNDETERMINED", "c2")],
      }),
    );

    expect(phase.state).toBe("AANDACHT");
    expect(phase.detail).toContain("1 niet vast te stellen");
  });
});

describe("buildMergePhase", () => {
  it("toont COMPLETED als daadwerkelijk gemerged — dat is in dit project de definitie", () => {
    const phase = buildMergePhase(buildMission({ status: "COMPLETED" }));

    expect(phase.state).toBe("KLAAR");
    expect(phase.detail).toContain("gemerged");
  });

  it("vraagt aandacht wanneer de missie op goedkeuring wacht", () => {
    expect(buildMergePhase(buildMission({ status: "WAITING_FOR_APPROVAL" })).state).toBe(
      "AANDACHT",
    );
  });

  it("blijft WACHT zolang de missie gewoon loopt", () => {
    expect(buildMergePhase(buildMission({ status: "WAITING_FOR_ROLE" })).state).toBe("WACHT");
  });

  it("vraagt aandacht wanneer de missie op het antwoord van de eigenaar wacht (stap 12b)", () => {
    const phase = buildMergePhase(buildMission({ status: "WAITING_FOR_OWNER" }));

    expect(phase.state).toBe("AANDACHT");
    expect(phase.detail).toContain("vraag van de Director");
  });
});

describe("deriveMissionPhases", () => {
  it("levert precies de vijf fases waarvoor vandaag echte gegevens bestaan", () => {
    // Verificatie en Review komen pas bij stap 11 en 12; die horen hier
    // bewust nog niet bij, ook niet als lege placeholder.
    expect(deriveMissionPhases(buildMission()).map((phase) => phase.id)).toEqual([
      "planning",
      "builder",
      "qa",
      "criteria",
      "merge",
    ]);
  });
});
