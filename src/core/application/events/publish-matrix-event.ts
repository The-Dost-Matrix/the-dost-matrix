import type {
  MatrixEventPayload,
  MatrixEventType,
} from "@/core/domain/events/matrix-event";
import { createMatrixEventRecord } from "@/core/repositories/matrix-event-repository";

export interface PublishMatrixEventInput {
  ownerId: string;
  missionId: string;
  workflowId: string;
  type: MatrixEventType;
  payload?: MatrixEventPayload;
}

export async function publishMatrixEvent(
  input: PublishMatrixEventInput,
): Promise<string> {
  return createMatrixEventRecord(input);
}
