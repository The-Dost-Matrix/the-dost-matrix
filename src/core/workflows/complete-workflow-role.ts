import { dispatchRole } from "@/core/roles/role-dispatcher";
import {
  getWorkflowRecord,
  updateWorkflowRecord,
} from "@/core/repositories/workflow-repository";
import { MAX_AUTOMATIC_REPAIR_ATTEMPTS } from "@/core/workflows/mission-lifecycle";
import { transitionWorkflow } from "@/core/workflows/workflow-engine";

export type WorkflowRoleOutcome =
  | "success"
  | "failure";

interface CompleteWorkflowRoleParams {
  workflowId: string;
  outcome: WorkflowRoleOutcome;
}

export async function completeWorkflowRole({
  workflowId,
  outcome,
}: CompleteWorkflowRoleParams): Promise<void> {
  let workflow = await getWorkflowRecord(workflowId);

  if (workflow.state === "building") {
    workflow = transitionWorkflow(
      workflow,
      outcome === "success"
        ? "testing"
        : "failed",
    );
  } else if (workflow.state === "testing") {
    if (outcome === "success") {
      workflow = transitionWorkflow(
        workflow,
        "documenting",
      );
    } else if (
      workflow.repairAttempts <
      MAX_AUTOMATIC_REPAIR_ATTEMPTS
    ) {
      workflow = {
        ...transitionWorkflow(
          workflow,
          "building",
        ),
        repairAttempts:
          workflow.repairAttempts + 1,
      };
    } else {
      workflow = transitionWorkflow(
        workflow,
        "failed",
      );
    }
  } else if (workflow.state === "documenting") {
    workflow = transitionWorkflow(
      workflow,
      outcome === "success"
        ? "completed"
        : "failed",
    );
  } else {
    throw new Error(
      `Workflow kan in status ${workflow.state} niet worden afgerond.`,
    );
  }

  await updateWorkflowRecord(workflow);

  if (
    workflow.state === "building" ||
    workflow.state === "testing" ||
    workflow.state === "documenting"
  ) {
    await dispatchRole({
      role: workflow.currentRole,
      missionId: workflow.missionId,
      ownerId: workflow.ownerId,
      command: workflow.command,
      workflowId,
    });
  }
}
