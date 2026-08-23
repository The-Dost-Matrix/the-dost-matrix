import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/core/firebase/admin";

import {
  DocumentRecord,
  DocumentStatus,
} from "@/domains/documents/model/document";

const COLLECTION = "documents";

function mapDocument(
  doc: FirebaseFirestore.DocumentSnapshot,
): DocumentRecord {
  const data = doc.data();

  if (!data) {
    throw new Error("Document kon niet worden gelezen.");
  }

  return {
    id: doc.id,

    ownerId: data.ownerId,

    projectId: data.projectId ?? "",

    title: data.title,

    fileName: data.fileName,

    mimeType: data.mimeType,

    sourceType: data.sourceType,

    status: data.status,

    knowledgeItems: data.knowledgeItems ?? 0,

    originalContent: data.originalContent,

    uploadedAt: data.uploadedAt?.toDate?.() ?? null,

    processedAt: data.processedAt?.toDate?.() ?? undefined,

    errorMessage: data.errorMessage,

    metadata: data.metadata ?? {},
  };
}

export async function createDocument(
  document: DocumentRecord,
): Promise<DocumentRecord> {
  const now = FieldValue.serverTimestamp();

  const ref = await adminDb.collection(COLLECTION).add({
    ownerId: document.ownerId,

    projectId: document.projectId ?? "",

    title: document.title,

    fileName: document.fileName,

    mimeType: document.mimeType,

    sourceType: document.sourceType,

    status: document.status,

    knowledgeItems: document.knowledgeItems,

    originalContent: document.originalContent ?? "",

    uploadedAt: now,

    processedAt: null,

    errorMessage: null,

    metadata: document.metadata ?? {},
  });

  return {
    ...document,
    id: ref.id,
  };
}

export async function getDocument(
  documentId: string,
): Promise<DocumentRecord | null> {
  const snapshot = await adminDb
    .collection(COLLECTION)
    .doc(documentId)
    .get();

  if (!snapshot.exists) {
    return null;
  }

  return mapDocument(snapshot);
}

export async function getDocumentsByOwner(
  ownerId: string,
): Promise<DocumentRecord[]> {
  const snapshot = await adminDb
    .collection(COLLECTION)
    .where("ownerId", "==", ownerId)
    .orderBy("uploadedAt", "desc")
    .get();

  return snapshot.docs.map(mapDocument);
}

export async function updateDocument(
  documentId: string,
  updates: Partial<DocumentRecord>,
): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(documentId)
    .update(updates);
}

export async function updateDocumentStatus(
  documentId: string,
  status: DocumentStatus,
): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(documentId)
    .update({
      status,
      processedAt: FieldValue.serverTimestamp(),
    });
}

export async function deleteDocument(
  documentId: string,
): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(documentId)
    .delete();
}