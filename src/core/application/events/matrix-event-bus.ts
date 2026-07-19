import { publishMatrixEvent } from "@/core/application/events/publish-matrix-event";
import type {
  MatrixEventPayload,
  MatrixEventType,
} from "@/core/domain/events/matrix-event";

export interface EmitMatrixEventInput {
  ownerId: string;
  missionId: string;
  workflowId: string;
  type: MatrixEventType;
  payload?: MatrixEventPayload;
}

export async function emitMatrixEvent(
  input: EmitMatrixEventInput,
): Promise<string> {
  return publishMatrixEvent(input);
}
