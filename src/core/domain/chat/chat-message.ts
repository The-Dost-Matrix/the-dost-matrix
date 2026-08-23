export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  ownerId: string;
  role: ChatRole;
  content: string;
  /** Provider + model that generated this message, e.g. "anthropic/claude-sonnet-5". Empty for user messages. */
  model: string;
  /** Ids of knowledge entries that were retrieved and used as context, for traceability. */
  usedKnowledgeIds: string[];
  createdAt: Date | null;
}
