import {
    addDoc,
    collection,
    serverTimestamp,
  } from "firebase/firestore";
  
  import { db } from "@/core/firebase/client";
  import { createBuildTaskInput } from "./task-planner";
  
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
  }: CreateBuildTaskParams) {
    const task = createBuildTaskInput({
      missionId,
      ownerId,
      command,
      estimatedHours,
    });
  
    const taskDocument = await addDoc(
      collection(db, "agentTasks"),
      {
        ...task,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    );
    
    await addDoc(
      collection(db, "auditEvents"),
      {
        ownerId,
        action: "builder.task.created",
        entityType: "agentTask",
        entityId: taskDocument.id,
        missionId,
        summary: `Builder-taak aangemaakt voor missie: ${command}`,
        createdAt: serverTimestamp(),
      },
    );
  
    return taskDocument.id;
  }