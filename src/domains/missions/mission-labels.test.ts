import { describe, it, expect } from "vitest";

import {
  MISSION_STATUSES,
  type MissionRiskLevel,
  type MissionV2,
} from "@/core/mission-engine/v2/mission";
import {
  RISK_LEVELS,
  formatMissionCost,
  missionStatusLabel,
  riskLevelLabel,
} from "./mission-labels";

/**
 * De risiconiveaus staan in het missiemodel als union-type (MissionRiskLevel),
 * niet als runtime-array. Deze Record is daarom bewust exhaustief getypeerd:
 * komt er in mission.ts een niveau bij, dan faalt de typecheck hier meteen —
 * en niet pas als iemand toevallig aan deze test denkt. De waarde is de
 * rangorde laag → hoog, waarmee de verwachte volgorde wordt afgeleid in
 * plaats van een tweede handgeschreven lijst te onderhouden.
 */
const RISK_LEVEL_ORDER: Record<MissionRiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

const EXPECTED_RISK_LEVELS = (Object.keys(RISK_LEVEL_ORDER) as MissionRiskLevel[]).sort(
  (a, b) => RISK_LEVEL_ORDER[a] - RISK_LEVEL_ORDER[b],
);

/**
 * formatMissionCost() leest alleen mission.spentCost en mission.budget; de
 * rest van MissionV2 is voor deze pure functie irrelevant. Daarom een minimaal
 * object met een cast, in plaats van een volledige missie na te bouwen (zelfde
 * aanpak als mockActiveMission() in route.test.ts).
 */
function buildMission(spentCost: number, maximumCost: number, currency: string): MissionV2 {
  return {
    spentCost,
    budget: { maximumCost, currency },
  } as unknown as MissionV2;
}

describe("missionStatusLabel", () => {
  it("geeft voor elke status uit het missiemodel een niet-lege omschrijving", () => {
    for (const status of MISSION_STATUSES) {
      const label = missionStatusLabel(status);

      expect(typeof label, `label voor status ${status}`).toBe("string");
      expect(label.trim().length, `label voor status ${status}`).toBeGreaterThan(0);
    }
  });

  it("dekt alle statussen die het missiemodel kent", () => {
    const labels = MISSION_STATUSES.map((status) => missionStatusLabel(status));

    expect(labels).toHaveLength(MISSION_STATUSES.length);
  });
});

describe("RISK_LEVELS", () => {
  it("bevat precies de risiconiveaus van het missiemodel, oplopend van laag naar hoog", () => {
    expect(RISK_LEVELS).toEqual(EXPECTED_RISK_LEVELS);
    expect(RISK_LEVELS).toHaveLength(EXPECTED_RISK_LEVELS.length);
  });

  it("staat strikt oplopend gesorteerd op risicozwaarte", () => {
    const ranks = RISK_LEVELS.map((level) => RISK_LEVEL_ORDER[level]);

    for (let index = 1; index < ranks.length; index += 1) {
      expect(ranks[index]).toBeGreaterThan(ranks[index - 1]);
    }
  });
});

describe("riskLevelLabel", () => {
  it("geeft voor elk risiconiveau een niet-lege omschrijving", () => {
    for (const level of RISK_LEVELS) {
      const label = riskLevelLabel(level);

      expect(typeof label, `label voor risiconiveau ${level}`).toBe("string");
      expect(label.trim().length, `label voor risiconiveau ${level}`).toBeGreaterThan(0);
    }
  });

  it("geeft elk risiconiveau een eigen, onderling unieke omschrijving", () => {
    const labels = RISK_LEVELS.map((level) => riskLevelLabel(level));

    expect(new Set(labels).size).toBe(RISK_LEVELS.length);
  });
});

describe("formatMissionCost", () => {
  it("noemt zowel het budgetbedrag als de valuta van het budget", () => {
    const mission = buildMission(12.5, 25, "EUR");

    const result = formatMissionCost(mission);

    expect(result).toContain(String(mission.budget.maximumCost));
    expect(result).toContain(mission.budget.currency);
  });

  it("gebruikt de valuta uit het budget en niet een vaste waarde", () => {
    const result = formatMissionCost(buildMission(1, 10, "USD"));

    expect(result).toContain("USD");
    expect(result).not.toContain("EUR");
  });

  it("toont de geschatte kosten als bedrag, ongeacht de getalopmaak", () => {
    const mission = buildMission(12.5, 25, "EUR");

    const result = formatMissionCost(mission);

    // Bewust geen vergelijking met een geformatteerde string ("12,50" vs
    // "12.50"): alleen de structuur en het hele-getal-deel worden gecontroleerd,
    // zodat de test niet breekt op locale- of afrondingsinstellingen.
    const match = result.match(/~\$([\d.,]+) geschat/);

    expect(match).not.toBeNull();
    expect(match?.[1]).toMatch(/^12([.,]\d+)?$/);
  });

  it("meldt expliciet dat het budget indicatief is en niets blokkeert", () => {
    const result = formatMissionCost(buildMission(0, 5, "EUR"));

    expect(result).toContain("indicatief");
    expect(result).toContain("blokkeert niets");
  });
});