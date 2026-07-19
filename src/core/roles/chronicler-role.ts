import { createRoleTaskRecord } from "@/core/repositories/role-task-repository";
import type { RoleExecutionResult } from "@/core/workflows/types";

export interface ExecuteChroniclerRoleInput {
  missionId: string;
  ownerId: string;
  command: string;
  workflowId: string;
}

export async function executeChroniclerRole({
  missionId,
  ownerId,
  command,
  workflowId,
}: ExecuteChroniclerRoleInput): Promise<RoleExecutionResult> {
  await createRoleTaskRecord({
    missionId,
    ownerId,
    workflowId,
    role: "Chronicler",
    title: `Documentatie voor missie ${missionId}`,
    description: command,
  });

  return {
    status: "waiting",
  };
}
