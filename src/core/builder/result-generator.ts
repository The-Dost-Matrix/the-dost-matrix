import type { BuildResult } from "./result-types";

interface CreateBuildResultInput {
  missionId: string;
  taskId: string;
  ownerId: string;
  description: string;
}

export function createBuildResultInput({
  missionId,
  taskId,
  ownerId,
  description,
}: CreateBuildResultInput): BuildResult {
  return {
    missionId,
    taskId,
    ownerId,
    output: `Builder heeft de taak voorbereid: ${description}`,
    status: "completed",
  };
}