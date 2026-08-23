import type {
  ArchivedConversationChunk,
} from "@/core/repositories/conversation-archive-repository";

export interface RankedConversationChunk {
  chunk: ArchivedConversationChunk;
  score: number;
  semanticScore: number;
  keywordScore: number;
  structureScore: number;
}

const DUTCH_STOP_WORDS = new Set([
  "aan",
  "als",
  "bij",
  "dan",
  "dat",
  "de",
  "deze",
  "die",
  "dit",
  "door",
  "een",
  "en",
  "er",
  "geen",
  "heb",
  "het",
  "hoe",
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
  "worden",
  "wordt",
  "zijn",
]);

export function normalizeSearchText(
  value: string,
): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(
  value: string,
): Set<string> {
  return new Set(
    normalizeSearchText(value)
      .split(/\s+/)
      .filter((token) => token.length > 2)
      .filter(
        (token) => !DUTCH_STOP_WORDS.has(token),
      ),
  );
}

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

  for (
    let index = 0;
    index < first.length;
    index += 1
  ) {
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

export function keywordScore(
  query: string,
  candidate: string,
): number {
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidate);

  if (
    queryTokens.size === 0 ||
    candidateTokens.size === 0
  ) {
    return 0;
  }

  let shared = 0;

  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      shared += 1;
    }
  }

  return shared / queryTokens.size;
}

function extractNumbers(value: string): Set<string> {
  return new Set(value.match(/\b\d+\b/g) ?? []);
}

function extractDateTerms(
  value: string,
): Set<string> {
  const normalized = normalizeSearchText(value);

  const months = [
    "januari",
    "februari",
    "maart",
    "april",
    "mei",
    "juni",
    "juli",
    "augustus",
    "september",
    "oktober",
    "november",
    "december",
  ];

  return new Set(
    months.filter((month) =>
      normalized.includes(month),
    ),
  );
}

function calculateStructureScore(
  query: string,
  candidate: string,
): number {
  const normalizedQuery =
    normalizeSearchText(query);

  const normalizedCandidate =
    normalizeSearchText(candidate);

  let score = 0;

  const queryNumbers = extractNumbers(query);
  const candidateNumbers =
    extractNumbers(candidate);

  for (const number of queryNumbers) {
    if (candidateNumbers.has(number)) {
      score += 0.08;
    }
  }

  const queryDates = extractDateTerms(query);
  const candidateDates =
    extractDateTerms(candidate);

  for (const date of queryDates) {
    if (candidateDates.has(date)) {
      score += 0.15;
    }
  }

  const asksForSteps =
    normalizedQuery.includes("stappen") ||
    normalizedQuery.includes("stap");

  if (asksForSteps) {
    const stepMatches =
      candidate.match(
        /\bstap\s*[1-9]\d*[\s.:)-]/gi,
      ) ?? [];

    score += Math.min(
      0.4,
      stepMatches.length * 0.1,
    );
  }

  const asksForDecision =
    normalizedQuery.includes("besluit") ||
    normalizedQuery.includes("beslissing") ||
    normalizedQuery.includes("voorgeschreven") ||
    normalizedQuery.includes("opdracht");

  if (
    asksForDecision &&
    /\b(besluit|beslissing|opdracht|afspraak|voorgeschreven)\b/i.test(
      candidate,
    )
  ) {
    score += 0.15;
  }

  if (
    normalizedCandidate.includes(
      normalizedQuery,
    )
  ) {
    score += 0.35;
  }

  return Math.min(score, 1);
}
function calculateContaminationPenalty(
  query: string,
  candidate: string,
): number {
  const normalizedQuery =
    normalizeSearchText(query);

  const normalizedCandidate =
    normalizeSearchText(candidate);

  let penalty = 0;

  const diagnosticMarkers = [
    "director memory diagnostics",
    "rankedchunks",
    "contentpreview",
    "semanticscore",
    "keywordscore",
    "structurescore",
    "conversationchunkcount",
    "archivecontextlength",
    "post api chat",
    "chunkid",
  ];

  for (const marker of diagnosticMarkers) {
    if (normalizedCandidate.includes(marker)) {
      penalty += 0.18;
    }
  }

  if (
    normalizedQuery &&
    normalizedCandidate.includes(normalizedQuery)
  ) {
    penalty += 0.35;
  }

  return Math.min(penalty, 0.9);
}

function calculateOriginalInstructionBoost(
  candidate: string,
): number {
  const normalized =
    normalizeSearchText(candidate);

  let boost = 0;

  if (
    normalized.includes(
      "ik ga het nog 1 keer eenvoudig uit leggen",
    ) ||
    normalized.includes(
      "ik ga nu stap voor stap vertellen wat je gaat maken",
    )
  ) {
    boost += 0.6;
  }

  if (
    normalized.includes(
      "bouw de beste director ter wereld",
    )
  ) {
    boost += 0.5;
  }

  if (
    normalized.includes(
      "geef deze director toegang tot de kennis in de second brain",
    )
  ) {
    boost += 0.4;
  }

  if (
    normalized.includes(
      "geef deze director toegang tot de volledige mappen structuur",
    )
  ) {
    boost += 0.4;
  }

  return Math.min(boost, 1.5);
}
function scoreChunk(
  query: string,
  queryEmbedding: number[] | null,
  chunk: ArchivedConversationChunk,
): RankedConversationChunk {
  const searchableText =
    `${chunk.filename}\n${chunk.content}`;

  const lexicalScore = keywordScore(
    query,
    searchableText,
  );

  const structureScore =
    calculateStructureScore(
      query,
      searchableText,
    );

  const hasComparableEmbedding =
    Boolean(queryEmbedding?.length) &&
    chunk.embedding.length ===
      queryEmbedding?.length;

  const semanticScore =
    hasComparableEmbedding
      ? Math.max(
          0,
          cosineSimilarity(
            queryEmbedding as number[],
            chunk.embedding,
          ),
        )
      : 0;

      const contaminationPenalty =
      calculateContaminationPenalty(
        query,
        searchableText,
      );
    
    const originalInstructionBoost =
      calculateOriginalInstructionBoost(
        searchableText,
      );
    
    const baseScore = hasComparableEmbedding
      ? semanticScore * 0.5 +
        lexicalScore * 0.2 +
        structureScore * 0.3
      : lexicalScore * 0.45 +
        structureScore * 0.55;
    
    const score = Math.max(
      0,
      baseScore +
        originalInstructionBoost -
        contaminationPenalty,
    );

  return {
    chunk,
    score,
    semanticScore,
    keywordScore: lexicalScore,
    structureScore,
  };
}

function expandBestConversation(
  ranked: RankedConversationChunk[],
  allChunks: ArchivedConversationChunk[],
  maximumResults: number,
): RankedConversationChunk[] {
  if (ranked.length === 0) {
    return [];
  }

  const conversationScores = new Map<
    string,
    number
  >();

  for (const item of ranked) {
    const currentScore =
      conversationScores.get(
        item.chunk.conversationId,
      ) ?? 0;

    conversationScores.set(
      item.chunk.conversationId,
      Math.max(currentScore, item.score),
    );
  }

  const bestConversationId =
    [...conversationScores.entries()]
      .sort(
        (first, second) =>
          second[1] - first[1],
      )[0]?.[0];

  if (!bestConversationId) {
    return ranked.slice(0, maximumResults);
  }

  const conversationChunks = allChunks
    .filter(
      (chunk) =>
        chunk.conversationId ===
        bestConversationId,
    )
    .sort(
      (first, second) =>
        first.chunkIndex -
        second.chunkIndex,
    );

  const rankedFromBestConversation =
    ranked.filter(
      (item) =>
        item.chunk.conversationId ===
        bestConversationId,
    );

  const selectedIndexes = new Set<number>();

  for (
    const item of rankedFromBestConversation.slice(
      0,
      3,
    )
  ) {
    for (
      let offset = -4;
      offset <= 4;
      offset += 1
    ) {
      selectedIndexes.add(
        item.chunk.chunkIndex + offset,
      );
    }
  }

  const rankedById = new Map(
    rankedFromBestConversation.map(
      (item) => [item.chunk.id, item],
    ),
  );

  const expanded =
    conversationChunks
      .filter((chunk) =>
        selectedIndexes.has(
          chunk.chunkIndex,
        ),
      )
      .map(
        (
          chunk,
        ): RankedConversationChunk => {
          const existing =
            rankedById.get(chunk.id);

          if (existing) {
            return existing;
          }

          const distanceToMatch = Math.min(
            ...rankedFromBestConversation.map(
              (item) =>
                Math.abs(
                  item.chunk.chunkIndex -
                    chunk.chunkIndex,
                ),
            ),
          );

          const nearest =
            rankedFromBestConversation
              .slice()
              .sort(
                (first, second) =>
                  Math.abs(
                    first.chunk.chunkIndex -
                      chunk.chunkIndex,
                  ) -
                  Math.abs(
                    second.chunk.chunkIndex -
                      chunk.chunkIndex,
                  ),
              )[0];

          return {
            chunk,
            score:
              (nearest?.score ?? 0.1) *
              Math.max(
                0.55,
                1 - distanceToMatch * 0.08,
              ),
            semanticScore:
              nearest?.semanticScore ?? 0,
            keywordScore:
              nearest?.keywordScore ?? 0,
            structureScore:
              nearest?.structureScore ?? 0,
          };
        },
      );

  return expanded
    .sort(
      (first, second) =>
        first.chunk.chunkIndex -
        second.chunk.chunkIndex,
    )
    .slice(0, maximumResults);
}

export function rankConversationChunks(
  query: string,
  queryEmbedding: number[] | null,
  chunks: ArchivedConversationChunk[],
  maximumResults = 8,
): RankedConversationChunk[] {
  const ranked = chunks
    .map((chunk) =>
      scoreChunk(
        query,
        queryEmbedding,
        chunk,
      ),
    )
    .filter((item) => item.score >= 0.06)
    .sort(
      (first, second) =>
        second.score - first.score,
    )
    .slice(
      0,
      Math.max(3, maximumResults - 2),
    );

    return expandBestConversation(
      ranked,
      chunks,
      maximumResults,
    );
}