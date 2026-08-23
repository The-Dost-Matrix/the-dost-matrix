import { createHash } from "node:crypto";

import { getEmbeddingProvider } from "@/core/llm/model-router";
import {
  archiveConversation,
  archiveConversationChunk,
  findConversationByFingerprint,
  getArchivedConversationChunks,
} from "@/core/repositories/conversation-archive-repository";

import { splitConversationIntoChunks } from "./chunk-service";

export function createConversationFingerprint(
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

export function normalizeConversationContent(
  content: string,
): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export interface ArchiveConversationServiceInput {
  ownerId: string;
  filename: string;
  content: string;
}

export interface ArchiveConversationServiceResult {
  conversationId: string;
  chunks: number;
  embedded: boolean;
}

export async function archiveConversationDocument(
  input: ArchiveConversationServiceInput,
): Promise<ArchiveConversationServiceResult> {
  const content = normalizeConversationContent(
    input.content,
  );

  const fingerprint =
    createConversationFingerprint(
      input.filename,
      content,
    );

  const existing =
    await findConversationByFingerprint(
      input.ownerId,
      fingerprint,
    );

    if (
      existing &&
      !shouldReprocessConversation(
        existing.fingerprint,
        fingerprint,
      )
    ) {
      // Tijdelijk opnieuw verwerken zodat oude archieven
      // de nieuwe, kleinere chunkstructuur krijgen.
    }

  const conversationId =
    await archiveConversation({
      ownerId: input.ownerId,
      filename: input.filename,
      content,
      fingerprint,
      archivedAt: new Date(),
    });

  const chunks =
    splitConversationIntoChunks(content);

  const embeddingProvider =
    getEmbeddingProvider();

  for (
    let index = 0;
    index < chunks.length;
    index += 1
  ) {
    const chunk = chunks[index];

    const embedding = embeddingProvider
      ? await embeddingProvider.embed(chunk)
      : [];

    await archiveConversationChunk({
      ownerId: input.ownerId,
      conversationId,
      filename: input.filename,
      chunkIndex: index,
      content: chunk,
      embedding,
    });
  }

  return {
    conversationId,
    chunks: chunks.length,
    embedded: Boolean(embeddingProvider),
  };
}

export function shouldReprocessConversation(
  existingFingerprint: string | null,
  newFingerprint: string,
): boolean {
  if (!existingFingerprint) {
    return true;
  }

  return existingFingerprint !== newFingerprint;
}