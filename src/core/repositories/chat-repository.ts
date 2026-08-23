import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/core/firebase/admin";
import type { ChatRole } from "@/core/domain/chat/chat-message";

const COLLECTION = "chatMessages";

export interface CreateChatMessageInput {
  ownerId: string;
  role: ChatRole;
  content: string;
  model?: string;
  usedKnowledgeIds?: string[];
}

export async function createChatMessage({
  ownerId,
  role,
  content,
  model = "",
  usedKnowledgeIds = [],
}: CreateChatMessageInput): Promise<string> {
  const doc = await adminDb.collection(COLLECTION).add({
    ownerId,
    role,
    content,
    model,
    usedKnowledgeIds,
    createdAt: FieldValue.serverTimestamp(),
  });

  return doc.id;
}

/** Last N messages for an owner, oldest first — used to build LLM context. */
export async function getRecentChatMessages(ownerId: string, limit = 20) {
  const snapshot = await adminDb
    .collection(COLLECTION)
    .where("ownerId", "==", ownerId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        role: data.role as ChatRole,
        content: data.content as string,
      };
    })
    .reverse();
}
