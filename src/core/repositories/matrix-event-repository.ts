import {
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";

import type {
  MatrixEventPayload,
  MatrixEventType,
} from "@/core/domain/events/matrix-event";
import { db } from "@/core/firebase/client";

export interface CreateMatrixEventRecordInput {
  ownerId: string;
  missionId: string;
  workflowId: string;
  type: MatrixEventType;
  payload?: MatrixEventPayload;
}

export async function createMatrixEventRecord({
  ownerId,
  missionId,
  workflowId,
  type,
  payload = {},
}: CreateMatrixEventRecordInput): Promise<string> {
  const eventDocument = await addDoc(
    collection(db, "matrixEvents"),
    {
      ownerId,
      missionId,
      workflowId,
      type,
      payload,
      createdAt: serverTimestamp(),
    },
  );

  return eventDocument.id;
}
