import type { EntityId, JsonValue } from "@/core/contracts/v2";
import type { MissionStatus } from "./mission";

export const MISSION_EVENT_TYPES = [
  "mission.created",
  "mission.ready",
  "mission.activated",
  "mission.state_changed",
  "mission.role_requested",
  "mission.owner_input_requested",
  "mission.approval_requested",
  "mission.replanning_requested",
  "mission.completed",
  "mission.failed",
  "mission.cancelled",
] as const;

export type MissionEventType = (typeof MISSION_EVENT_TYPES)[number];

export interface MissionEventPayload extends Record<string, JsonValue> {
  missionId: EntityId;
  previousStatus: MissionStatus | null;
  status: MissionStatus;
}
