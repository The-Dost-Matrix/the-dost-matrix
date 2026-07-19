import { dispatchRole } from "@/core/roles/role-dispatcher";
import {
  createWorkflowRecord,
  updateWorkflowRecord,
} from "@/core/repositories/workflow-repository";
import {
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
}: StartMissionWorkflowParams): Promise<string> {
  let workflow = createWorkflowContext(
    missionId,
    ownerId,
    command,
  );

  const workflowId = await createWorkflowRecord(workflow);

  workflow = {
    ...workflow,
    id: workflowId,
  };

  workflow = transitionWorkflow(workflow, "planning");

  await updateWorkflowRecord(workflow);

  const result = await dispatchRole({
    role: workflow.currentRole,
    missionId,
    ownerId,
    command,
    workflowId,
  });

  if (
    result.status === "completed" &&
    result.nextState
  ) {
    workflow = transitionWorkflow(
      workflow,
      result.nextState,
    );

    await updateWorkflowRecord(workflow);

    if (
      workflow.state === "building" ||
      workflow.state === "testing" ||
      workflow.state === "documenting"
    ) {
      await dispatchRole({
        role: workflow.currentRole,
        missionId,
        ownerId,
        command,
        workflowId,
      });
    }
  }

  return workflowId;
}
