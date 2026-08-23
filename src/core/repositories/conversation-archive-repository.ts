import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { adminDb } from "@/core/firebase/admin";

const ARCHIVE_COLLECTION = "conversationArchive";
const CHUNK_COLLECTION = "conversationArchiveChunks";

export interface ArchiveConversationInput {
  ownerId: string;
  filename: string;
  content: string;
  fingerprint: string;
  archivedAt: Date;
}

export interface ArchiveConversationChunkInput {
  ownerId: string;
  conversationId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
}

export interface ArchivedConversation {
  id: string;
  ownerId: string;
  filename: string;
  content: string;
  fingerprint: string;
archivedAt: Date | null;
  createdAt: Date | null;
}

export interface ArchivedConversationChunk {
  id: string;
  ownerId: string;
  conversationId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  createdAt: Date | null;
}

export async function archiveConversation(
  input: ArchiveConversationInput,
): Promise<string> {
  const doc = await adminDb
    .collection(ARCHIVE_COLLECTION)
    .add({
      ownerId: input.ownerId,
      filename: input.filename.trim(),
      content: input.content.trim(),
      fingerprint: input.fingerprint,
      archivedAt: input.archivedAt,
      createdAt: FieldValue.serverTimestamp(),
    });

  return doc.id;
}

export async function archiveConversationChunk(
  input: ArchiveConversationChunkInput,
): Promise<string> {
  const doc = await adminDb
    .collection(CHUNK_COLLECTION)
    .add({
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      filename: input.filename.trim(),
      chunkIndex: input.chunkIndex,
      content: input.content.trim(),
      embedding: input.embedding,
      createdAt: FieldValue.serverTimestamp(),
    });

  return doc.id;
}

export async function getArchivedConversations(
  ownerId: string,
): Promise<ArchivedConversation[]> {
  const snapshot = await adminDb
    .collection(ARCHIVE_COLLECTION)
    .where("ownerId", "==", ownerId)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();

    return {
      id: doc.id,
      ownerId:
        typeof data.ownerId === "string"
          ? data.ownerId
          : "",
      filename:
        typeof data.filename === "string"
          ? data.filename
          : "",
      content:
        typeof data.content === "string"
          ? data.content
          : "",
          fingerprint:
  typeof data.fingerprint === "string"
    ? data.fingerprint
    : "",

archivedAt:
  data.archivedAt?.toDate?.() ?? null,
      createdAt: data.createdAt?.toDate?.() ?? null,
    };
  });
}

export async function getArchivedConversationChunks(
  ownerId: string,
): Promise<ArchivedConversationChunk[]> {
  const snapshot = await adminDb
    .collection(CHUNK_COLLECTION)
    .where("ownerId", "==", ownerId)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();

    return {
      id: doc.id,
      ownerId:
        typeof data.ownerId === "string"
          ? data.ownerId
          : "",
      conversationId:
        typeof data.conversationId === "string"
          ? data.conversationId
          : "",
      filename:
        typeof data.filename === "string"
          ? data.filename
          : "",
      chunkIndex:
        typeof data.chunkIndex === "number"
          ? data.chunkIndex
          : 0,
      content:
        typeof data.content === "string"
          ? data.content
          : "",
      embedding: Array.isArray(data.embedding)
        ? data.embedding.filter(
            (value: unknown): value is number =>
              typeof value === "number",
          )
        : [],
      createdAt: data.createdAt?.toDate?.() ?? null,
    };
  });
}

export async function getArchivedConversation(
  ownerId: string,
  id: string,
): Promise<ArchivedConversation> {
  const snapshot = await adminDb
    .collection(ARCHIVE_COLLECTION)
    .doc(id)
    .get();

  if (
    !snapshot.exists ||
    snapshot.data()?.ownerId !== ownerId
  ) {
    throw new Error("Conversatie niet gevonden.");
  }

  const data = snapshot.data();

  if (!data) {
    throw new Error("Conversatie kon niet worden gelezen.");
  }

  return {
    id: snapshot.id,
    ownerId:
      typeof data.ownerId === "string"
        ? data.ownerId
        : "",
    filename:
      typeof data.filename === "string"
        ? data.filename
        : "",
    content:
      typeof data.content === "string"
        ? data.content
        : "",
        fingerprint:
  typeof data.fingerprint === "string"
    ? data.fingerprint
    : "",

archivedAt:
  data.archivedAt?.toDate?.() ?? null,
    createdAt: data.createdAt?.toDate?.() ?? null,
  };
}
export async function findConversationByFingerprint(
  ownerId: string,
  fingerprint: string,
): Promise<ArchivedConversation | null> {
  const snapshot = await adminDb
    .collection(ARCHIVE_COLLECTION)
    .where("ownerId", "==", ownerId)
    .where("fingerprint", "==", fingerprint)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  const data = doc.data();

  return {
    id: doc.id,
    ownerId:
      typeof data.ownerId === "string"
        ? data.ownerId
        : "",
    filename:
      typeof data.filename === "string"
        ? data.filename
        : "",
    content:
      typeof data.content === "string"
        ? data.content
        : "",
        fingerprint:
  typeof data.fingerprint === "string"
    ? data.fingerprint
    : "",

archivedAt:
  data.archivedAt?.toDate?.() ?? null,
    createdAt: data.createdAt?.toDate?.() ?? null,
  };
}
export function createContentFingerprint(
  filename: string,
  content: string,
): string {
  return createHash("sha256")
    .update(
      `${filename.trim().toLowerCase()}\n${content
        .trim()
        .replace(/\r\n/g, "\n")}`,
    )
    .digest("hex");
}