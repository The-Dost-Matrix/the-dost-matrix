import type { MissionStatus } from "./mission";

const TRANSITIONS: Readonly<Record<MissionStatus, readonly MissionStatus[]>> = {
  DRAFT: ["READY", "CANCELLED"],
  READY: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["WAITING_FOR_ROLE", "WAITING_FOR_OWNER", "WAITING_FOR_APPROVAL", "REPLANNING", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"],
  WAITING_FOR_ROLE: ["ACTIVE", "REPLANNING", "PAUSED", "FAILED", "CANCELLED"],
  WAITING_FOR_OWNER: ["ACTIVE", "PAUSED", "CANCELLED"],
  WAITING_FOR_APPROVAL: ["ACTIVE", "PAUSED", "FAILED", "CANCELLED"],
  REPLANNING: ["ACTIVE", "WAITING_FOR_OWNER", "WAITING_FOR_APPROVAL", "PAUSED", "FAILED", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionMission(from: MissionStatus, to: MissionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertMissionTransition(from: MissionStatus, to: MissionStatus): void {
  if (!canTransitionMission(from, to)) {
    throw new Error(`Ongeldige mission-transitie: ${from} -> ${to}`);
  }
}
