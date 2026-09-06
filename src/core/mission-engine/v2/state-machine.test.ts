import { describe, expect, it } from "vitest";

import { assertMissionTransition, canTransitionMission } from "./state-machine";
import { MISSION_STATUSES, type MissionStatus } from "./mission";

/**
 * De eindstatussen zoals ze uit de overgangstabel van state-machine.ts volgen:
 * dit zijn de enige statussen zonder uitgaande overgangen. Ze worden hier
 * expliciet benoemd én hieronder tegen het gedrag van canTransitionMission
 * gecontroleerd, zodat deze lijst niet stilletjes uit de pas kan lopen met de
 * broncode.
 */
const TERMINAL_STATUSES: readonly MissionStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

describe("canTransitionMission", () => {
  it("staat een overgang toe die in de overgangstabel staat", () => {
    expect(canTransitionMission("DRAFT", "READY")).toBe(true);
    expect(canTransitionMission("READY", "ACTIVE")).toBe(true);
    expect(canTransitionMission("ACTIVE", "WAITING_FOR_ROLE")).toBe(true);
    expect(canTransitionMission("PAUSED", "ACTIVE")).toBe(true);
  });

  it("weigert een overgang die niet in de overgangstabel staat", () => {
    expect(canTransitionMission("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransitionMission("READY", "COMPLETED")).toBe(false);
    expect(canTransitionMission("WAITING_FOR_OWNER", "COMPLETED")).toBe(false);
    expect(canTransitionMission("PAUSED", "FAILED")).toBe(false);
  });

  it("weigert een overgang naar dezelfde status", () => {
    for (const status of MISSION_STATUSES) {
      expect(canTransitionMission(status, status)).toBe(false);
    }
  });

  it("laat vanuit elke eindstatus geen enkele overgang meer toe", () => {
    for (const terminal of TERMINAL_STATUSES) {
      for (const target of MISSION_STATUSES) {
        expect(canTransitionMission(terminal, target)).toBe(false);
      }
    }
  });

  it("laat vanuit elke niet-eindstatus minimaal één overgang toe", () => {
    const nonTerminalStatuses = MISSION_STATUSES.filter(
      (status) => !TERMINAL_STATUSES.includes(status),
    );

    for (const status of nonTerminalStatuses) {
      const reachable = MISSION_STATUSES.filter((target) =>
        canTransitionMission(status, target),
      );

      expect(reachable.length).toBeGreaterThan(0);
    }
  });

  it("kan een geannuleerde mission niet heropenen", () => {
    expect(canTransitionMission("CANCELLED", "ACTIVE")).toBe(false);
    expect(canTransitionMission("COMPLETED", "ACTIVE")).toBe(false);
    expect(canTransitionMission("FAILED", "REPLANNING")).toBe(false);
  });
});

describe("assertMissionTransition", () => {
  it("gooit niet bij een toegestane overgang", () => {
    expect(() => assertMissionTransition("DRAFT", "READY")).not.toThrow();
    expect(() => assertMissionTransition("ACTIVE", "COMPLETED")).not.toThrow();
  });

  it("gooit bij een niet-toegestane overgang", () => {
    expect(() => assertMissionTransition("DRAFT", "COMPLETED")).toThrow();
  });

  it("gooit met een foutbericht dat de betrokken statussen noemt", () => {
    expect(() => assertMissionTransition("DRAFT", "COMPLETED")).toThrow(
      "Ongeldige mission-transitie: DRAFT -> COMPLETED",
    );
    expect(() => assertMissionTransition("COMPLETED", "ACTIVE")).toThrow(
      "Ongeldige mission-transitie: COMPLETED -> ACTIVE",
    );
  });

  it("gooit vanuit elke eindstatus, ongeacht de doelstatus", () => {
    for (const terminal of TERMINAL_STATUSES) {
      for (const target of MISSION_STATUSES) {
        expect(() => assertMissionTransition(terminal, target)).toThrow();
      }
    }
  });

  it("gooit bij een overgang naar dezelfde status", () => {
    expect(() => assertMissionTransition("ACTIVE", "ACTIVE")).toThrow(
      "Ongeldige mission-transitie: ACTIVE -> ACTIVE",
    );
  });

  it("volgt exact hetzelfde oordeel als canTransitionMission", () => {
    for (const from of MISSION_STATUSES) {
      for (const to of MISSION_STATUSES) {
        if (canTransitionMission(from, to)) {
          expect(() => assertMissionTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertMissionTransition(from, to)).toThrow();
        }
      }
    }
  });
});