import { createDirectorPlan } from "@/core/application/director/create-director-plan";
import { createDirectorPlanInput } from "@/core/director/planner";
import type { RoleExecutionResult } from "@/core/workflows/types";

export interface ExecuteDirectorRoleInput {
  missionId: string;
  ownerId: string;
  command: string;
  workflowId: string;
}

export async function executeDirectorRole({
  missionId,
  ownerId,
  command,
}: ExecuteDirectorRoleInput): Promise<RoleExecutionResult> {
  const plan = createDirectorPlanInput({
    missionId,
    ownerId,
    command,
  });

  await createDirectorPlan({
    missionId,
    ownerId,
    command,
  });

  if (plan.requiredAgents.includes("Builder")) {
    return {
      status: "completed",
      nextState: "building",
    };
  }

  if (plan.requiredAgents.includes("QA")) {
    return {
      status: "completed",
      nextState: "testing",
    };
  }

  if (plan.requiredAgents.includes("Chronicler")) {
    return {
      status: "completed",
      nextState: "documenting",
    };
  }

  return {
    status: "completed",
    nextState: "completed",
  };
}
