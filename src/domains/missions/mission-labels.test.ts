import { describe, it, expect } from "vitest";

import type { MissionAdvanceOutcome } from "@/core/mission-engine/v2/autonomous-advance";

import {
  MISSION_STATUSES,
  type AssignmentStatus,
  type MissionBudget,
  type MissionRiskLevel,
  type MissionV2,
} from "@/core/mission-engine/v2/mission";

import {
  RISK_LEVELS,
  advanceStoppedReasonLabel,
  assignmentStatusLabel,
  formatMissionCost,
  missionStatusLabel,
  riskLevelLabel,
} from "./mission-labels";

/**
 * formatMissionCost() leest van een missie alleen `spentCost` en `budget`
 * (zie mission-labels.ts). Een volledig geldige MissionV2 nabouwen zou hier
 * alleen ruis toevoegen — vandaar deze minimale opzet met een cast, in
 * dezelfde geest als de mockActiveMission()-helper in
 * src/app/api/missions/v2/route.test.ts.
 */
function buildMission(spentCost: number, budget: MissionBudget): MissionV2 {
  return { spentCost, budget } as unknown as MissionV2;
}

/**
 * Exhaustieve lijst van risiconiveaus, afgeleid van het missiemodel: dankzij
 * het Record<MissionRiskLevel, true>-type faalt de typecheck zodra er een
 * niveau aan MissionRiskLevel wordt toegevoegd of verwijderd, zodat deze
 * tests nooit stilletjes een niveau overslaan.
 */
const ALL_RISK_LEVELS: Record<MissionRiskLevel, true> = {
  LOW: true,
  MEDIUM: true,
  HIGH: true,
  CRITICAL: true,
};

describe("missionStatusLabel", () => {
  it("geeft voor elke missiestatus uit MISSION_STATUSES een niet-lege tekst terug", () => {
    // MISSION_STATUSES komt uit het missiemodel zelf, zodat een nieuwe
    // status niet ongemerkt zonder label kan blijven.
    expect(MISSION_STATUSES.length).toBeGreaterThan(0);

    for (const status of MISSION_STATUSES) {
      const label = missionStatusLabel(status);

      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("assignmentStatusLabel", () => {
  it("geeft Actief terug voor ACTIVE", () => {
    expect(assignmentStatusLabel("ACTIVE")).toBe("Actief");
  });

  it("geeft Afgerond terug voor COMPLETED", () => {
    expect(assignmentStatusLabel("COMPLETED")).toBe("Afgerond");
  });

  it("geeft Mislukt terug voor FAILED", () => {
    expect(assignmentStatusLabel("FAILED")).toBe("Mislukt");
  });

  it("geeft Wacht op jouw input terug voor WAITING_FOR_INPUT", () => {
    expect(assignmentStatusLabel("WAITING_FOR_INPUT")).toBe("Wacht op jouw input");
  });

  it("geeft Geannuleerd terug voor CANCELLED", () => {
    expect(assignmentStatusLabel("CANCELLED")).toBe("Geannuleerd");
  });

  it("geeft een onbekende status ongewijzigd terug", () => {
    const status = "DRAFT" as AssignmentStatus;

    expect(assignmentStatusLabel(status)).toBe(status);
  });
});

describe("advanceStoppedReasonLabel", () => {
  it("geeft voor elke stopreden een niet-lege Nederlandse omschrijving in plaats van de ruwe waarde", () => {
    const labels: Record<MissionAdvanceOutcome["stoppedReason"], string> = {
      TERMINAL_OR_WAITING_STATUS: "Missie beëindigd of in wachtstand",
      STEP_LIMIT_REACHED: "Stappenlimiet bereikt",
      DEADLINE_REACHED: "Tijdslimiet bereikt",
      WAITING_FOR_CI: "Wachten tot de CI-controle klaar is",
      DIRECTOR_ERROR: "Fout bij de regisseur",
    };
    const reasons = Object.keys(labels) as MissionAdvanceOutcome["stoppedReason"][];

    for (const reason of reasons) {
      const label = advanceStoppedReasonLabel(reason);

      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(reason);
      expect(label).toBe(labels[reason]);
    }
  });

  it("omschrijft WAITING_FOR_CI neutraal als wachten tot de CI-controle klaar is", () => {
    expect(advanceStoppedReasonLabel("WAITING_FOR_CI")).toBe(
      "Wachten tot de CI-controle klaar is",
    );
  });
});

describe("RISK_LEVELS", () => {
  it("bevat precies de risiconiveaus van het missiemodel, in oplopende volgorde van laag naar hoog", () => {
    expect(RISK_LEVELS).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });

  it("mist geen enkel risiconiveau uit MissionRiskLevel en bevat geen duplicaten", () => {
    const modelLevels = Object.keys(ALL_RISK_LEVELS) as MissionRiskLevel[];

    expect([...RISK_LEVELS].sort()).toEqual([...modelLevels].sort());
    expect(new Set(RISK_LEVELS).size).toBe(RISK_LEVELS.length);
  });
});

describe("riskLevelLabel", () => {
  it("geeft per risiconiveau een niet-lege omschrijving terug", () => {
    for (const level of RISK_LEVELS) {
      const label = riskLevelLabel(level);

      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("geeft voor elk risiconiveau een eigen omschrijving, zodat niveaus in de UI niet door elkaar lopen", () => {
    const labels = RISK_LEVELS.map((level) => riskLevelLabel(level));

    expect(new Set(labels).size).toBe(RISK_LEVELS.length);
  });
});

describe("formatMissionCost", () => {
  it("zet zowel de geschatte kosten als het budgetbedrag met valuta in de uitvoer", () => {
    const mission = buildMission(12.34, { maximumCost: 25, currency: "EUR" });

    const result = formatMissionCost(mission);

    // Extraheer beide bedragen in uitvoervolgorde en vergelijk numeriek:
    // een punt of komma en eventuele afsluitende nullen maken niet uit.
    const spent = result
      .match(/-?\d+(?:[.,]\d+)?/g)
      ?.map((label) => Number(label.replace(",", ".")));

    expect(spent).toEqual([mission.spentCost, mission.budget.maximumCost]);
    expect(result).toContain("EUR");
  });

  it("neemt de valuta over uit het budget-object van de missie", () => {
    const currency = "USD";
    const mission = buildMission(0.5, { maximumCost: 3, currency });

    const result = formatMissionCost(mission);

    expect(result).toContain(currency);
    expect(result).not.toContain("EUR");

    const spent = result
      .match(/-?\d+(?:[.,]\d+)?/g)
      ?.map((label) => Number(label.replace(",", ".")));

    expect(spent).toEqual([mission.spentCost, mission.budget.maximumCost]);
  });

  it("geeft altijd een niet-lege string terug, ook als er nog niets is uitgegeven", () => {
    const result = formatMissionCost(buildMission(0, { maximumCost: 0, currency: "EUR" }));

    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("EUR");
  });
});
