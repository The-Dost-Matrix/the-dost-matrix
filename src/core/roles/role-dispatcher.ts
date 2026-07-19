import { executeBuilderRole } from "@/core/roles/builder-role";
import { executeChroniclerRole } from "@/core/roles/chronicler-role";
import {
  executeDirectorRole,
  type ExecuteDirectorRoleInput,
} from "@/core/roles/director-role";
import { executeQaRole } from "@/core/roles/qa-role";
import type {
  RoleExecutionResult,
  WorkflowRole,
} from "@/core/workflows/types";

export interface DispatchRoleInput
  extends ExecuteDirectorRoleInput {
  role: WorkflowRole;
}

export async function dispatchRole({
  role,
  missionId,
  ownerId,
  command,
  workflowId,
}: DispatchRoleInput): Promise<RoleExecutionResult> {
  const input = {
    missionId,
    ownerId,
    command,
    workflowId,
  };

  switch (role) {
    case "Director":
      return executeDirectorRole(input);

    case "Builder":
      return executeBuilderRole(input);

    case "QA":
      return executeQaRole(input);

    case "Chronicler":
      return executeChroniclerRole(input);

    default: {
      const unsupportedRole: never = role;

      throw new Error(
        `Onbekende workflowrol: ${unsupportedRole}`,
      );
    }
  }
}
