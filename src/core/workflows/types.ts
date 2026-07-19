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

export interface WorkflowContext {
  missionId: string;
  ownerId: string;

  currentRole: WorkflowRole;

  state: WorkflowState;

  startedAt: Date;

  updatedAt: Date;
}