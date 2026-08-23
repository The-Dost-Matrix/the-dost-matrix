import type { EntityId, JsonValue } from "@/core/contracts/v2";
import type { MissionStatus } from "./mission";

export const MISSION_EVENT_TYPES = [
  "mission.created",
  "mission.ready",
  "mission.activated",
  "mission.role_dispatched",
  "mission.role_result_recorded",
  "mission.owner_input_requested",
  "mission.owner_input_recorded",
  "mission.approval_requested",
  "mission.approval_recorded",
  "mission.criterion_evaluated",
  "mission.replanning_requested",
  "mission.paused",
  "mission.resumed",
  "mission.completed",
  "mission.failed",
  "mission.cancelled",
  "mission.decision_recorded",
] as const;

export type MissionEventType = (typeof MISSION_EVENT_TYPES)[number];

export type MissionEventPayload = Record<string, JsonValue>;
