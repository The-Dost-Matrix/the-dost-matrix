export type WorkflowRole =
  | "Director"
  | "Builder"
  | "QA"
  | "Chronicler";

export type WorkflowState =
  | "planned"
  | "planning"
  | "building"
  | "testing"
  | "documenting"
  | "completed"
  | "failed";

export type RoleExecutionStatus =
  | "completed"
  | "waiting";

export interface WorkflowContext {
  id?: string;
  missionId: string;
  ownerId: string;
  command: string;
  currentRole: WorkflowRole;
  state: WorkflowState;
  repairAttempts: number;
  startedAt: Date;
  updatedAt: Date;
}

export interface RoleExecutionResult {
  status: RoleExecutionStatus;
  nextState?: WorkflowState;
}
