import { recordAuditEvent } from "@/core/application/audit/audit-service";
import { createBuildTaskInput } from "@/core/builder/task-planner";
import { createBuildTaskRecord } from "@/core/repositories/build-task-repository";

interface CreateBuildTaskParams {
  missionId: string;
  ownerId: string;
  command: string;
  estimatedHours: number;
}

export async function createBuildTask({
  missionId,
  ownerId,
  command,
  estimatedHours,
}: CreateBuildTaskParams): Promise<string> {
  const task = createBuildTaskInput({
    missionId,
    ownerId,
    command,
    estimatedHours,
  });

  const taskId = await createBuildTaskRecord(task);

  await recordAuditEvent({
    ownerId,
    action: "builder.task.created",
    entityType: "agentTask",
    entityId: taskId,
    missionId,
    summary: `Builder-taak aangemaakt voor missie: ${command}`,
  });

  return taskId;
}