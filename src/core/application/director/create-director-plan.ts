import { createBuildTask } from "@/core/application/tasks/create-build-task";
import { recordAuditEvent } from "@/core/application/audit/audit-service";
import { createDirectorPlanInput } from "@/core/director/planner";
import { createDirectorPlanRecord } from "@/core/repositories/director-plan-repository";

interface CreateDirectorPlanParams {
  missionId: string;
  ownerId: string;
  command: string;
}

export async function createDirectorPlan({
  missionId,
  ownerId,
  command,
}: CreateDirectorPlanParams): Promise<string> {
  const plan = createDirectorPlanInput({
    missionId,
    ownerId,
    command,
  });

  const planId = await createDirectorPlanRecord(plan);

  await recordAuditEvent({
    ownerId,
    action: "director.plan.created",
    entityType: "directorPlan",
    entityId: planId,
    missionId,
    summary: `Director-plan aangemaakt voor missie: ${command}`,
  });

  if (plan.requiredAgents.includes("Builder")) {
    await createBuildTask({
      missionId,
      ownerId,
      command,
      estimatedHours: plan.estimatedHours,
    });
  }

  return planId;
}