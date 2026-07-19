import {
    addDoc,
    collection,
    serverTimestamp,
  } from "firebase/firestore";
  
  import { createBuildTask } from "@/core/builder/builder";
  import { db } from "@/core/firebase/client";
  import { createDirectorPlanInput } from "./planner";
  
  interface CreateDirectorPlanParams {
    missionId: string;
    ownerId: string;
    command: string;
  }
  
  export async function createDirectorPlan({
    missionId,
    ownerId,
    command,
  }: CreateDirectorPlanParams) {
    const plan = createDirectorPlanInput({
      missionId,
      ownerId,
      command,
    });
  
    const planDocument = await addDoc(
      collection(db, "directorPlans"),
      {
        ...plan,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    );
    if (plan.requiredAgents.includes("Builder")) {
        await createBuildTask({
          missionId,
          ownerId,
          command,
          estimatedHours: plan.estimatedHours,
        });
      }
    await addDoc(
      collection(db, "auditEvents"),
      {
        ownerId,
        action: "director.plan.created",
        entityType: "directorPlan",
        entityId: planDocument.id,
        missionId,
        summary: `Director-plan aangemaakt voor missie: ${command}`,
        createdAt: serverTimestamp(),
      },
    );
  
    return planDocument.id;
  }