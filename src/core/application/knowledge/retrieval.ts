import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";
import { getKnowledgeEntries } from "@/core/repositories/knowledge-repository";

import { findRelevantKnowledge, hasKeywordMatch } from "./relevance";

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

/**
 * Het keywordfilter, 20 september 2026.
 *
 * De drempel in relevance.ts ligt op 0,08, en een kennisitem krijgt al 0,05
 * voor zijn type en 0,03 voor zijn levensfase. Samen precies 0,08 — bij nul
 * tekstovereenkomst met de vraag. Een item kan dus binnenkomen zonder dat er
 * ook maar één woord uit de vraag in voorkomt.
 *
 * Voor het Second Brain-zoekscherm is dat op 18 september afgevangen met
 * hasKeywordMatch. Hier gebeurde dat niet, waardoor de Director plekken in
 * zijn prompt verspeelde aan kennis die niets met de missie te maken had.
 * Nu geldt dezelfde eis op beide plekken.
 *
 * Bewust hier en niet in findRelevantKnowledge zelf: die functie berekent de
 * rangschikking, en die berekening is elders (in tests en in het zoekscherm)
 * al vastgelegd. Filteren is een keuze van de aanroeper.
 */
export async function retrieveKnowledgeContext(
  ownerId: string,
  query: string,
  queryEmbedding: number[] | null,
  topK = 12,
): Promise<KnowledgeEntry[]> {
  const entries = await getKnowledgeEntries(ownerId);

  const ranked = findRelevantKnowledge(
    query,
    queryEmbedding,
    entries,
    topK,
  );

  return ranked.filter((entry) => hasKeywordMatch(query, entry));
}
