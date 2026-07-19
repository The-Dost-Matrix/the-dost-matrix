export type MissionStatus =
  | "draft"
  | "planned"
  | "in_progress"
  | "awaiting_approval"
  | "completed"
  | "cancelled";

export interface Mission {
  id: string;
  ownerId: string;
  command: string;
  status: MissionStatus;
  source: "text" | "voice";
  createdAt: Date | null;
}
