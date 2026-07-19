import { createRoleTaskRecord } from "@/core/repositories/role-task-repository";
import type { RoleExecutionResult } from "@/core/workflows/types";

export interface ExecuteBuilderRoleInput {
  missionId: string;
  ownerId: string;
  command: string;
  workflowId: string;
}

export async function executeBuilderRole({
  missionId,
  ownerId,
  command,
  workflowId,
}: ExecuteBuilderRoleInput): Promise<RoleExecutionResult> {
  await createRoleTaskRecord({
    missionId,
    ownerId,
    workflowId,
    role: "Builder",
    title: `Bouwopdracht voor missie ${missionId}`,
    description: command,
  });

  return {
    status: "waiting",
  };
}
