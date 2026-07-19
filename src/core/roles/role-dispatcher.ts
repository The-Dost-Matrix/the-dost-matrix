import {
    executeDirectorRole,
    type ExecuteDirectorRoleInput,
  } from "@/core/roles/director-role";
  import type { WorkflowRole } from "@/core/workflows/types";
  
  export interface DispatchRoleInput extends ExecuteDirectorRoleInput {
    role: WorkflowRole;
  }
  
  export async function dispatchRole({
    role,
    missionId,
    ownerId,
    command,
  }: DispatchRoleInput): Promise<void> {
    switch (role) {
      case "Director":
        await executeDirectorRole({
          missionId,
          ownerId,
          command,
        });
        return;
  
      case "Builder":
      case "QA":
      case "Chronicler":
        throw new Error(`Rol is nog niet geïmplementeerd: ${role}`);
  
      default: {
        const unsupportedRole: never = role;
        throw new Error(`Onbekende workflowrol: ${unsupportedRole}`);
      }
    }
  }