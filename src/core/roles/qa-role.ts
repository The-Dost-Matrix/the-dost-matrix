import { createRoleTaskRecord } from "@/core/repositories/role-task-repository";
import type { RoleExecutionResult } from "@/core/workflows/types";

export interface ExecuteQaRoleInput {
  missionId: string;
  ownerId: string;
  command: string;
  workflowId: string;
}

export async function executeQaRole({
  missionId,
  ownerId,
  command,
  workflowId,
}: ExecuteQaRoleInput): Promise<RoleExecutionResult> {
  await createRoleTaskRecord({
    missionId,
    ownerId,
    workflowId,
    role: "QA",
    title: `QA-controle voor missie ${missionId}`,
    description: command,
  });

  return {
    status: "waiting",
  };
}
