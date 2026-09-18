import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";
import { getKnowledgeEntries } from "@/core/repositories/knowledge-repository";

import { findRelevantKnowledge } from "./relevance";

/**
 * Het ophalen van kennis voor een vraag: eerst alles van de eigenaar uit de
 * opslag, dan de scoreregels eroverheen.
 *
 * De scoreregels zelf staan sinds 18 september 2026 in relevance.ts — zie de
 * toelichting daar. Dit bestand blijft de serverkant: het is het enige van de
 * twee dat de repository (en daarmee `firebase-admin`) inleest.
 *
 * `findRelevantKnowledge` wordt hier bewust dóórgeëxporteerd. Alles wat die
 * functie vandaag uit `./retrieval` importeert — waaronder de tests uit PR #64
 * — blijft daardoor werken zonder één regel aan te passen. Een verhuizing die
 * aanroepers breekt is een verhuizing die je later terugdraait.
 */
export { findRelevantKnowledge };

export async function retrieveKnowledgeContext(
  ownerId: string,
  query: string,
  queryEmbedding: number[] | null,
  topK = 12,
): Promise<KnowledgeEntry[]> {
  const entries = await getKnowledgeEntries(ownerId);

  return findRelevantKnowledge(
    query,
    queryEmbedding,
    entries,
    topK,
  );
}
