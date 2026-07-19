import {
    addDoc,
    collection,
    serverTimestamp,
  } from "firebase/firestore";
  
  import type { DirectorPlan } from "@/core/domain/director/director-plan";
  import { db } from "@/core/firebase/client";
  
  export interface CreateDirectorPlanRecordInput
    extends Omit<DirectorPlan, "createdAt"> {}
  
  export async function createDirectorPlanRecord(
    plan: CreateDirectorPlanRecordInput,
  ): Promise<string> {
    const planDocument = await addDoc(
      collection(db, "directorPlans"),
      {
        ...plan,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    );
  
    return planDocument.id;
  }