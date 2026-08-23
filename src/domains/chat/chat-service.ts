import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/core/firebase/client";
import type { ChatMessage, ChatRole } from "@/core/domain/chat/chat-message";

/** Sends a message through the server-side /api/chat route (never calls LLM providers from the browser). */
export async function sendChatMessage(
  user: User,
  content: string,
): Promise<{ reply: string; model: string }> {
  const idToken = await user.getIdToken();

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ content }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? "Chatbericht versturen is mislukt.");
  }

  return data;
}

export function subscribeToChatMessages(
  ownerId: string,
  onChange: (messages: ChatMessage[]) => void,
  onError: (error: Error) => void,
): () => void {
  const messagesQuery = query(
    collection(db, "chatMessages"),
    where("ownerId", "==", ownerId),
    orderBy("createdAt", "asc"),
  );

  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      const messages = snapshot.docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          ownerId: data.ownerId as string,
          role: data.role as ChatRole,
          content: data.content as string,
          model: (data.model as string) ?? "",
          usedKnowledgeIds: (data.usedKnowledgeIds as string[]) ?? [],
          createdAt: data.createdAt?.toDate?.() ?? null,
        } satisfies ChatMessage;
      });

      onChange(messages);
    },
    onError,
  );
}
