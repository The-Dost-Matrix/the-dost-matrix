import { createDirectorPlan } from "@/core/application/director/create-director-plan";

export interface ExecuteDirectorRoleInput {
  missionId: string;
  ownerId: string;
  command: string;
}

export async function executeDirectorRole({
  missionId,
  ownerId,
  command,
}: ExecuteDirectorRoleInput): Promise<void> {
  await createDirectorPlan({
    missionId,
    ownerId,
    command,
  });
}