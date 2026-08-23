import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";
import { getKnowledgeEntries } from "@/core/repositories/knowledge-repository";

export async function getEngineeringKnowledge(
  ownerId: string,
): Promise<KnowledgeEntry[]> {
  const entries = await getKnowledgeEntries(ownerId);

  return entries.filter(
    (entry) =>
      entry.status === "approved" &&
      entry.lifecycle === "foundation",
  );
}