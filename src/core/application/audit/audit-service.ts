import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/core/firebase/client";

interface RecordAuditEventInput {
  ownerId: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  missionId?: string;
}

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<string> {
  const auditDocument = await addDoc(collection(db, "auditEvents"), {
    ownerId: input.ownerId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    summary: input.summary,
    ...(input.missionId ? { missionId: input.missionId } : {}),
    createdAt: serverTimestamp(),
  });
  return auditDocument.id;
}
