import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { recordAuditEvent } from "@/core/application/audit/audit-service";
import { createBuildTask } from "@/core/application/tasks/create-build-task";
import { db } from "@/core/firebase/client";
import { createDirectorPlanInput } from "@/core/director/planner";

interface CreateDirectorPlanParams {
  missionId: string;
  ownerId: string;
  command: string;
}

export async function createDirectorPlan({ missionId, ownerId, command }: CreateDirectorPlanParams): Promise<string> {
  const plan = createDirectorPlanInput({ missionId, ownerId, command });
  const planDocument = await addDoc(collection(db, "directorPlans"), {
    ...plan,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await recordAuditEvent({
    ownerId,
    action: "director.plan.created",
    entityType: "directorPlan",
    entityId: planDocument.id,
    missionId,
    summary: `Director-plan aangemaakt voor missie: ${command}`,
  });
  if (plan.requiredAgents.includes("Builder")) {
    await createBuildTask({ missionId, ownerId, command, estimatedHours: plan.estimatedHours });
  }
  return planDocument.id;
}
