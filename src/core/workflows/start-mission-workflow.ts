import { dispatchRole } from "@/core/roles/role-dispatcher";
import {
  canContinueWorkflow,
  createWorkflowContext,
  transitionWorkflow,
} from "@/core/workflows/workflow-engine";

interface StartMissionWorkflowParams {
  missionId: string;
  ownerId: string;
  command: string;
}

export async function startMissionWorkflow({
  missionId,
  ownerId,
  command,
}: StartMissionWorkflowParams): Promise<void> {
  let workflow = createWorkflowContext(
    missionId,
    ownerId,
  );

  while (canContinueWorkflow(workflow)) {
    if (workflow.state === "planned") {
      workflow = transitionWorkflow(
        workflow,
        "planning",
      );
    }

    await dispatchRole({
      role: workflow.currentRole,
      missionId,
      ownerId,
      command,
    });

    return;
  }
}