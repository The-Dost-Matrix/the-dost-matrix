import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { recordAuditEvent } from "@/core/application/audit/audit-service";
import { db } from "@/core/firebase/client";
import { createBuildTaskInput } from "@/core/builder/task-planner";

interface CreateBuildTaskParams {
  missionId: string;
  ownerId: string;
  command: string;
  estimatedHours: number;
}

export async function createBuildTask({ missionId, ownerId, command, estimatedHours }: CreateBuildTaskParams): Promise<string> {
  const task = createBuildTaskInput({ missionId, ownerId, command, estimatedHours });
  const taskDocument = await addDoc(collection(db, "agentTasks"), {
    ...task,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await recordAuditEvent({
    ownerId,
    action: "builder.task.created",
    entityType: "agentTask",
    entityId: taskDocument.id,
    missionId,
    summary: `Builder-taak aangemaakt voor missie: ${command}`,
  });
  return taskDocument.id;
}
