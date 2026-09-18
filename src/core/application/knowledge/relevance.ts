import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

/**
 * De scoreregels van het Second Brain, los van waar de kennis vandaan komt.
 *
 * WAAROM DIT EEN EIGEN BESTAND IS
 *
 * Dit stond tot 18 september 2026 in retrieval.ts, samen met
 * `retrieveKnowledgeContext` — en die haalt de kennisitems uit Firestore via
 * de repository, die op haar beurt `firebase-admin` inleest. Daarmee was de
 * scoreberekening onbereikbaar voor de browser: één import zou het hele
 * Admin-pakket de clientbundel in trekken.
 *
 * De doorzoekbare Second Brain-pagina (stap 20) heeft precies deze regels
 * nodig. Het alternatief was een tweede zoekimplementatie aan de clientkant,
 * en dan zou het scherm andere kennis "relevant" vinden dan de Director
 * gebruikt — twee waarheden over dezelfde vraag, waarvan je pas maanden later
 * merkt dat ze uiteenlopen.
 *
 * Hier staat dus uitsluitend rekenwerk: tekst in, score uit, geen netwerk en
 * geen database. `retrieval.ts` blijft de plek die de kennis ophaalt, en
 * exporteert `findRelevantKnowledge` onveranderd door, zodat bestaande
 * aanroepen en tests niets merken van deze verhuizing.
 */

type ScoredKnowledgeEntry = {
  entry: KnowledgeEntry;
  score: number;
};

const DUTCH_STOP_WORDS = new Set([
  "aan",
  "als",
  "bij",
  "dan",
  "dat",
  "de",
  "den",
  "der",
  "deze",
  "die",
  "dit",
  "door",
  "een",
  "en",
  "er",
  "geen",
  "het",
  "hoe",
  "hun",
  "ik",
  "in",
  "is",
  "kan",
  "maar",
  "met",
  "naar",
  "niet",
  "nog",
  "om",
  "of",
  "ons",
  "ook",
  "op",
  "over",
  "te",
  "tot",
  "uit",
  "van",
  "voor",
  "wat",
  "we",
  "wel",
  "werd",
  "worden",
  "wordt",
  "zijn",
  "zou",
]);

const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

function cosineSimilarity(
  first: number[],
  second: number[],
): number {
  if (
    first.length === 0 ||
    second.length === 0 ||
    first.length !== second.length
  ) {
    return 0;
  }

  let dotProduct = 0;
  let firstNorm = 0;
  let secondNorm = 0;

  for (let index = 0; index < first.length; index += 1) {
    dotProduct += first[index] * second[index];
    firstNorm += first[index] * first[index];
    secondNorm += second[index] * second[index];
  }

  if (firstNorm === 0 || secondNorm === 0) {
    return 0;
  }

  return (
    dotProduct /
    (Math.sqrt(firstNorm) * Math.sqrt(secondNorm))
  );
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Set<string> {
  const normalized = normalizeText(text);

  return new Set(
    normalized
      .split(/\s+/)
      .filter((word) => word.length > 2)
      .filter((word) => !DUTCH_STOP_WORDS.has(word))
      .filter((word) => !ENGLISH_STOP_WORDS.has(word)),
  );
}

function countSharedTokens(
  queryTokens: Set<string>,
  candidateTokens: Set<string>,
): number {
  let shared = 0;

  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      shared += 1;
    }
  }

  return shared;
}

function tokenOverlapScore(
  queryTokens: Set<string>,
  candidateTokens: Set<string>,
): number {
  if (
    queryTokens.size === 0 ||
    candidateTokens.size === 0
  ) {
    return 0;
  }

  const shared = countSharedTokens(
    queryTokens,
    candidateTokens,
  );

  if (shared === 0) {
    return 0;
  }

  const queryCoverage = shared / queryTokens.size;
  const candidateCoverage = shared / candidateTokens.size;

  return queryCoverage * 0.75 + candidateCoverage * 0.25;
}

function phraseMatchScore(
  query: string,
  candidate: string,
): number {
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidate);

  if (!normalizedQuery || !normalizedCandidate) {
    return 0;
  }

  if (normalizedCandidate === normalizedQuery) {
    return 1;
  }

  if (normalizedCandidate.includes(normalizedQuery)) {
    return 0.9;
  }

  if (normalizedQuery.includes(normalizedCandidate)) {
    return 0.65;
  }

  return 0;
}

function getLifecycleBoost(
  entry: KnowledgeEntry,
): number {
  switch (entry.lifecycle) {
    case "foundation":
      return 0.08;

    case "project":
      return 0.05;

    case "working":
      return 0.02;

    case "temporary":
      return 0;

    default:
      return 0.03;
  }
}

function getTypeBoost(
  entry: KnowledgeEntry,
): number {
  switch (entry.type) {
    case "architecture":
    case "decision":
    case "vision":
    case "process":
    case "preference":
    case "lesson":
      return 0.05;

    case "risk":
    case "goal":
    case "project":
      return 0.03;

    default:
      return 0;
  }
}

function buildSearchText(
  entry: KnowledgeEntry,
): string {
  return [
    entry.title,
    entry.summary,
    entry.content,
    entry.project,
    entry.sourceSection,
    entry.type,
    entry.lifecycle,
    ...entry.tags,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" &&
        value.trim().length > 0,
    )
    .join("\n");
}

function calculateKeywordScore(
  query: string,
  queryTokens: Set<string>,
  entry: KnowledgeEntry,
): number {
  const contentScore = tokenOverlapScore(
    queryTokens,
    tokenize(entry.content),
  );

  const titleScore = tokenOverlapScore(
    queryTokens,
    tokenize(entry.title ?? ""),
  );

  const summaryScore = tokenOverlapScore(
    queryTokens,
    tokenize(entry.summary ?? ""),
  );

  const tagScore = tokenOverlapScore(
    queryTokens,
    tokenize(entry.tags.join(" ")),
  );

  const metadataScore = tokenOverlapScore(
    queryTokens,
    tokenize(
      [
        entry.project,
        entry.sourceSection,
        entry.type,
        entry.lifecycle,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );

  const phraseScore = Math.max(
    phraseMatchScore(query, entry.title ?? ""),
    phraseMatchScore(query, entry.summary ?? ""),
    phraseMatchScore(query, entry.content),
  );

  return (
    contentScore * 0.35 +
    titleScore * 0.25 +
    summaryScore * 0.12 +
    tagScore * 0.13 +
    metadataScore * 0.05 +
    phraseScore * 0.1
  );
}

function calculateScore(
  query: string,
  queryTokens: Set<string>,
  queryEmbedding: number[] | null,
  entry: KnowledgeEntry,
): number {
  const keywordScore = calculateKeywordScore(
    query,
    queryTokens,
    entry,
  );

  const embeddingScore =
    queryEmbedding &&
    queryEmbedding.length > 0 &&
    entry.embedding.length === queryEmbedding.length
      ? Math.max(
          0,
          cosineSimilarity(
            queryEmbedding,
            entry.embedding,
          ),
        )
      : 0;

  const hasComparableEmbedding =
    Boolean(queryEmbedding?.length) &&
    entry.embedding.length === queryEmbedding?.length;

  const relevanceScore = hasComparableEmbedding
    ? embeddingScore * 0.68 + keywordScore * 0.32
    : keywordScore;

  return (
    relevanceScore +
    getLifecycleBoost(entry) +
    getTypeBoost(entry)
  );
}

function removeNearDuplicates(
  items: ScoredKnowledgeEntry[],
): ScoredKnowledgeEntry[] {
  const seen = new Set<string>();

  return items.filter(({ entry }) => {
    const key = normalizeText(
      [
        entry.type,
        entry.title,
        entry.content,
      ]
        .filter(Boolean)
        .join("::"),
    );

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/**
 * Of de tekst van een kennisitem überhaupt raakvlak heeft met de zoekvraag.
 *
 * WAAROM DIT APART BESTAAT
 *
 * `findRelevantKnowledge` telt bij de tekstscore nog een opslag op voor de
 * levensfase en het type van een item (zie getLifecycleBoost en getTypeBoost).
 * Een beslissing zonder ingevulde levensfase krijgt daarmee 0,05 + 0,03 =
 * precies de drempel van 0,08 — en haalt die dus óók bij een zoekvraag waar
 * geen enkel woord van overeenkomt.
 *
 * Voor de Director is dat gedrag goed: hij wil zijn context vullen met de
 * beste kennis die er is, en bij gebrek aan een tekstuele treffer is een
 * architectuurbeslissing nuttiger dan niets. Voor een zoekveld is het
 * onzin — wie een woord intypt dat nergens voorkomt, hoort niets te vinden
 * en geen willekeurige beslissing.
 *
 * Vandaar deze aparte vraag. De rangschikking blijft ongemoeid; het scherm
 * legt er alleen een eis naast die de Director niet stelt.
 */
export function hasKeywordMatch(query: string, entry: KnowledgeEntry): boolean {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) return true;

  return calculateKeywordScore(trimmedQuery, tokenize(trimmedQuery), entry) > 0;
}

/**
 * Geeft uitsluitend goedgekeurde kennis terug.
 * Combineert semantische embeddings met titel-, tag-,
 * metadata- en inhoudsovereenkomst.
 */
export function findRelevantKnowledge(
  query: string,
  queryEmbedding: number[] | null,
  entries: KnowledgeEntry[],
  topK = 12,
): KnowledgeEntry[] {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const approvedEntries = entries.filter(
    (entry) =>
      entry.status === "approved" &&
      entry.content.trim().length > 0,
  );

  if (approvedEntries.length === 0) {
    return [];
  }

  const queryTokens = tokenize(trimmedQuery);

  const scored = approvedEntries
    .map(
      (entry): ScoredKnowledgeEntry => ({
        entry,
        score: calculateScore(
          trimmedQuery,
          queryTokens,
          queryEmbedding,
          entry,
        ),
      }),
    )
    .filter(({ score }) => score >= 0.08)
    .sort((first, second) => second.score - first.score);

  return removeNearDuplicates(scored)
    .slice(0, topK)
    .map(({ entry }) => entry);
}
