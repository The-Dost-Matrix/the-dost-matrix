import {
    addDoc,
    collection,
    serverTimestamp,
  } from "firebase/firestore";
  
  import { db } from "@/core/firebase/client";
  import { createBuildResultInput } from "./result-generator";
  
  interface SaveBuildResultParams {
    missionId: string;
    taskId: string;
    ownerId: string;
    description: string;
  }
  
  export async function saveBuildResult({
    missionId,
    taskId,
    ownerId,
    description,
  }: SaveBuildResultParams) {
    const result = createBuildResultInput({
      missionId,
      taskId,
      ownerId,
      description,
    });
  
    const resultDocument = await addDoc(
      collection(db, "buildResults"),
      {
        ...result,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    );
  
    await addDoc(
      collection(db, "auditEvents"),
      {
        ownerId,
        action: "builder.result.created",
        entityType: "buildResult",
        entityId: resultDocument.id,
        missionId,
        summary: `Builder-resultaat opgeslagen`,
        createdAt: serverTimestamp(),
      },
    );
  
    return resultDocument.id;
  }