import {
  assertWorkflowTransition,
  getRoleForWorkflowState,
  isTerminalWorkflowState,
} from "@/core/workflows/mission-lifecycle";
import type {
  WorkflowContext,
  WorkflowState,
} from "@/core/workflows/types";

export function createWorkflowContext(
  missionId: string,
  ownerId: string,
  command: string,
): WorkflowContext {
  const now = new Date();

  return {
    missionId,
    ownerId,
    command,
    currentRole: "Director",
    state: "planned",
    repairAttempts: 0,
    startedAt: now,
    updatedAt: now,
  };
}

export function transitionWorkflow(
  context: WorkflowContext,
  nextState: WorkflowState,
): WorkflowContext {
  assertWorkflowTransition(context.state, nextState);

  return {
    ...context,
    state: nextState,
    currentRole: getRoleForWorkflowState(nextState),
    updatedAt: new Date(),
  };
}

export function canContinueWorkflow(
  context: WorkflowContext,
): boolean {
  return !isTerminalWorkflowState(context.state);
}
