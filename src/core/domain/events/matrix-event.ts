export type MatrixEventType =
  | "mission.workflow.started"
  | "workflow.state.changed"
  | "role.dispatched"
  | "role.completed"
  | "workflow.completed"
  | "workflow.failed";

export interface MatrixEventPayload {
  [key: string]: unknown;
}

export interface MatrixEvent {
  id?: string;
  ownerId: string;
  missionId: string;
  workflowId: string;
  type: MatrixEventType;
  payload: MatrixEventPayload;
  createdAt: Date | null;
}
