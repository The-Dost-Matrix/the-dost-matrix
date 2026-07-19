import {
    addDoc,
    collection,
    serverTimestamp,
  } from "firebase/firestore";
  
  import { db } from "@/core/firebase/client";
  
  export interface RecordAuditEventInput {
    ownerId: string;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    missionId?: string;
  }
  
  export async function recordAuditEvent({
    ownerId,
    action,
    entityType,
    entityId,
    summary,
    missionId,
  }: RecordAuditEventInput): Promise<string> {
    const auditDocument = await addDoc(
      collection(db, "auditEvents"),
      {
        ownerId,
        action,
        entityType,
        entityId,
        summary,
        ...(missionId ? { missionId } : {}),
        createdAt: serverTimestamp(),
      },
    );
  
    return auditDocument.id;
  }