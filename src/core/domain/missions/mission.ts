export type MissionSource = "text" | "voice";

export type MissionStatus =
  | "draft"
  | "planned"
  | "awaiting_approval"
  | "active"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export interface Mission {
  id: string;
  ownerId: string;
  command: string;
  status: MissionStatus;
  source: MissionSource;
  createdAt: Date | null;
  updatedAt?: Date | null;
}
