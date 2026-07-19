import type { BuildTask } from "./types";

interface CreateBuildTaskInput {
  missionId: string;
  ownerId: string;
  command: string;
  estimatedHours: number;
}

export function createBuildTaskInput({
  missionId,
  ownerId,
  command,
  estimatedHours,
}: CreateBuildTaskInput): BuildTask {
  return {
    missionId,
    ownerId,
    title: `Bouwopdracht voor missie ${missionId}`,
    description: command,
    assignedAgent: "Builder",
    status: "planned",
    estimatedHours,
  };
}