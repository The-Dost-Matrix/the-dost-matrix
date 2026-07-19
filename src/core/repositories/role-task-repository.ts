import {
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "@/core/firebase/client";
import type { WorkflowRole } from "@/core/workflows/types";

export interface CreateRoleTaskRecordInput {
  missionId: string;
  ownerId: string;
  workflowId: string;
  role: Exclude<WorkflowRole, "Director">;
  title: string;
  description: string;
  estimatedHours?: number;
}

export async function createRoleTaskRecord({
  missionId,
  ownerId,
  workflowId,
  role,
  title,
  description,
  estimatedHours,
}: CreateRoleTaskRecordInput): Promise<string> {
  const taskDocument = await addDoc(
    collection(db, "agentTasks"),
    {
      missionId,
      ownerId,
      workflowId,
      title,
      description,
      assignedAgent: role,
      status: "planned",
      ...(estimatedHours === undefined
        ? {}
        : { estimatedHours }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  );

  return taskDocument.id;
}
