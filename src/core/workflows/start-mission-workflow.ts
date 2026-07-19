import { emitMatrixEvent } from "@/core/application/events/matrix-event-bus";
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

  await emitMatrixEvent({
    ownerId,
    missionId,
    workflowId,
    type: "mission.workflow.started",
    payload: {
      command,
      state: workflow.state,
    },
  });

  const previousState = workflow.state;
  workflow = transitionWorkflow(workflow, "planning");

  await updateWorkflowRecord(workflow);

  await emitMatrixEvent({
    ownerId,
    missionId,
    workflowId,
    type: "workflow.state.changed",
    payload: {
      previousState,
      nextState: workflow.state,
      currentRole: workflow.currentRole,
    },
  });

  await emitMatrixEvent({
    ownerId,
    missionId,
    workflowId,
    type: "role.dispatched",
    payload: {
      role: workflow.currentRole,
      state: workflow.state,
    },
  });

  const result = await dispatchRole({
    role: workflow.currentRole,
    missionId,
    ownerId,
    command,
    workflowId,
  });

  await emitMatrixEvent({
    ownerId,
    missionId,
    workflowId,
    type: "role.completed",
    payload: {
      role: workflow.currentRole,
      status: result.status,
      nextState: result.nextState ?? null,
    },
  });

  if (
    result.status === "completed" &&
    result.nextState
  ) {
    const currentState = workflow.state;
    workflow = transitionWorkflow(
      workflow,
      result.nextState,
    );

    await updateWorkflowRecord(workflow);

    await emitMatrixEvent({
      ownerId,
      missionId,
      workflowId,
      type: "workflow.state.changed",
      payload: {
        previousState: currentState,
        nextState: workflow.state,
        currentRole: workflow.currentRole,
      },
    });

    if (
      workflow.state === "building" ||
      workflow.state === "testing" ||
      workflow.state === "documenting"
    ) {
      await emitMatrixEvent({
        ownerId,
        missionId,
        workflowId,
        type: "role.dispatched",
        payload: {
          role: workflow.currentRole,
          state: workflow.state,
        },
      });

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
