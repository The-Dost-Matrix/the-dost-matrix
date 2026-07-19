import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/core/firebase/client";
import type {
  WorkflowContext,
  WorkflowRole,
  WorkflowState,
} from "@/core/workflows/types";

interface FirestoreDateValue {
  toDate?: () => Date;
}

interface WorkflowRecordData {
  missionId: string;
  ownerId: string;
  command: string;
  currentRole: WorkflowRole;
  state: WorkflowState;
  repairAttempts: number;
  startedAt?: FirestoreDateValue;
  updatedAt?: FirestoreDateValue;
}

export async function createWorkflowRecord(
  context: WorkflowContext,
): Promise<string> {
  const workflowDocument = await addDoc(
    collection(db, "missionWorkflows"),
    {
      missionId: context.missionId,
      ownerId: context.ownerId,
      command: context.command,
      currentRole: context.currentRole,
      state: context.state,
      repairAttempts: context.repairAttempts,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  );

  return workflowDocument.id;
}

export async function getWorkflowRecord(
  workflowId: string,
): Promise<WorkflowContext> {
  const snapshot = await getDoc(
    doc(db, "missionWorkflows", workflowId),
  );

  if (!snapshot.exists()) {
    throw new Error(`Workflow niet gevonden: ${workflowId}`);
  }

  const data = snapshot.data() as WorkflowRecordData;

  return {
    id: snapshot.id,
    missionId: data.missionId,
    ownerId: data.ownerId,
    command: data.command,
    currentRole: data.currentRole,
    state: data.state,
    repairAttempts: data.repairAttempts ?? 0,
    startedAt: data.startedAt?.toDate?.() ?? new Date(),
    updatedAt: data.updatedAt?.toDate?.() ?? new Date(),
  };
}

export async function updateWorkflowRecord(
  context: WorkflowContext,
): Promise<void> {
  if (!context.id) {
    throw new Error("Workflow-ID ontbreekt.");
  }

  await updateDoc(
    doc(db, "missionWorkflows", context.id),
    {
      currentRole: context.currentRole,
      state: context.state,
      repairAttempts: context.repairAttempts,
      updatedAt: serverTimestamp(),
    },
  );
}
