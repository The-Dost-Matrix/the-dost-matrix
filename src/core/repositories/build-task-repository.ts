import {
    addDoc,
    collection,
    serverTimestamp,
  } from "firebase/firestore";
  
  import type { BuildTask } from "@/core/domain/tasks/build-task";
  import { db } from "@/core/firebase/client";
  
  export interface CreateBuildTaskRecordInput
    extends Omit<BuildTask, "createdAt" | "updatedAt"> {}
  
  export async function createBuildTaskRecord(
    task: CreateBuildTaskRecordInput,
  ): Promise<string> {
    const taskDocument = await addDoc(
      collection(db, "agentTasks"),
      {
        ...task,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    );
  
    return taskDocument.id;
  }