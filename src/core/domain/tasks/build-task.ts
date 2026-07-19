export type BuildTaskStatus = "planned" | "building" | "completed" | "failed" | "cancelled";

export interface BuildTask {
  missionId: string;
  ownerId: string;
  title: string;
  description: string;
  assignedAgent: "Builder";
  status: BuildTaskStatus;
  estimatedHours: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}
