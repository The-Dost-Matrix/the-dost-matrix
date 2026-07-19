import type {
  WorkflowRole,
  WorkflowState,
} from "@/core/workflows/types";

export const MAX_AUTOMATIC_REPAIR_ATTEMPTS = 2;

const allowedTransitions: Record<WorkflowState, WorkflowState[]> = {
  planned: ["planning", "failed"],
  planning: [
    "building",
    "testing",
    "documenting",
    "completed",
    "failed",
  ],
  building: ["testing", "failed"],
  testing: [
    "building",
    "documenting",
    "completed",
    "failed",
  ],
  documenting: ["completed", "failed"],
  completed: [],
  failed: [],
};

const roleByState: Record<WorkflowState, WorkflowRole> = {
  planned: "Director",
  planning: "Director",
  building: "Builder",
  testing: "QA",
  documenting: "Chronicler",
  completed: "Director",
  failed: "Director",
};

export function canTransitionWorkflow(
  currentState: WorkflowState,
  nextState: WorkflowState,
): boolean {
  return allowedTransitions[currentState].includes(nextState);
}

export function assertWorkflowTransition(
  currentState: WorkflowState,
  nextState: WorkflowState,
): void {
  if (!canTransitionWorkflow(currentState, nextState)) {
    throw new Error(
      `Ongeldige workflowtransitie: ${currentState} â†’ ${nextState}`,
    );
  }
}

export function getRoleForWorkflowState(
  state: WorkflowState,
): WorkflowRole {
  return roleByState[state];
}

export function isTerminalWorkflowState(
  state: WorkflowState,
): boolean {
  return state === "completed" || state === "failed";
}
