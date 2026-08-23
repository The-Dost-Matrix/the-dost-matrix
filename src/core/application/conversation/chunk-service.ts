export const CHUNK_LENGTH = 6000;
export const CHUNK_OVERLAP = 800;

export function splitConversationIntoChunks(
  content: string,
): string[] {
  const normalized = content.trim();

  if (!normalized) {
    return [];
  }

  if (normalized.length <= CHUNK_LENGTH) {
    return [normalized];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(
      start + CHUNK_LENGTH,
      normalized.length,
    );

    if (end < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf(
        "\n\n",
        end,
      );

      const lineBreak = normalized.lastIndexOf(
        "\n",
        end,
      );

      const splitPoint = Math.max(
        paragraphBreak,
        lineBreak,
      );

      if (
        splitPoint >
        start + CHUNK_LENGTH * 0.6
      ) {
        end = splitPoint;
      }
    }

    const chunk = normalized
      .slice(start, end)
      .trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}