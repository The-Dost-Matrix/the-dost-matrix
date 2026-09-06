import { describe, expect, it } from "vitest";

import {
  CHUNK_LENGTH,
  CHUNK_OVERLAP,
  splitConversationIntoChunks,
} from "./chunk-service";

/**
 * Bouwt een deterministische tekst zonder whitespace, zodat het opknippen
 * puur op basis van CHUNK_LENGTH en CHUNK_OVERLAP gebeurt.
 */
function makeText(length: number): string {
  let text = "";

  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(97 + (index % 26));
  }

  return text;
}

describe("splitConversationIntoChunks", () => {
  it("returns no chunks for empty or whitespace-only content", () => {
    expect(splitConversationIntoChunks("")).toEqual([]);
    expect(splitConversationIntoChunks("   ")).toEqual([]);
    expect(splitConversationIntoChunks("  \n\t \n  ")).toEqual([]);
  });

  it("returns a single trimmed chunk when the content fits within one chunk", () => {
    const content = "Dit is een kort gesprek tussen owner en director.";

    const chunks = splitConversationIntoChunks(`  ${content}  `);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(content);
  });

  it("returns chunks as strings", () => {
    const eersteChunk: string = splitConversationIntoChunks(
      "een korte tekst",
    )[0];

    expect(typeof eersteChunk).toBe("string");
    expect(eersteChunk).toBe("een korte tekst");
  });

  it("keeps content that stays below the chunk length in a single chunk", () => {
    const content = makeText(Math.floor(CHUNK_LENGTH * 0.6));

    const chunks = splitConversationIntoChunks(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(content);
  });

  it("keeps content of exactly the chunk length in a single chunk", () => {
    // De implementatie splitst pas bij `normalized.length <= CHUNK_LENGTH`
    // te overschrijden, dus precies CHUNK_LENGTH blijft één stuk.
    const content = makeText(CHUNK_LENGTH);

    const chunks = splitConversationIntoChunks(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(content);
  });

  it("splits content that is clearly longer than the chunk length into multiple chunks", () => {
    const content = makeText(CHUNK_LENGTH * 3);

    const chunks = splitConversationIntoChunks(content);

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk).toBe(chunk.trim());
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_LENGTH);
    }
  });

  it("overlaps consecutive chunks by the configured overlap", () => {
    const content = makeText(CHUNK_LENGTH * 2 + CHUNK_OVERLAP);

    const chunks = splitConversationIntoChunks(content);

    expect(chunks.length).toBeGreaterThan(1);

    for (let index = 0; index < chunks.length - 1; index += 1) {
      const tailOfChunk = chunks[index].slice(-CHUNK_OVERLAP);

      expect(tailOfChunk).toHaveLength(CHUNK_OVERLAP);
      expect(chunks[index + 1].startsWith(tailOfChunk)).toBe(true);
      expect(chunks[index + 1].slice(0, CHUNK_OVERLAP)).toBe(tailOfChunk);
    }
  });

  it("prefers a paragraph break as split point when it is far enough into the chunk", () => {
    // De implementatie accepteert een splitspunt pas voorbij
    // `start + CHUNK_LENGTH * 0.6`, dus de eerste alinea moet daar ruim
    // voorbij liggen en de totale tekst moet CHUNK_LENGTH overschrijden.
    const firstParagraph = "A".repeat(Math.floor(CHUNK_LENGTH * 0.7));
    const secondParagraph = "B".repeat(Math.floor(CHUNK_LENGTH * 0.5));
    const content = `${firstParagraph}\n\n${secondParagraph}`;

    const chunks = splitConversationIntoChunks(content);

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk).toBe(chunk.trim());
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_LENGTH);
    }

    expect(chunks[0]).toBe(firstParagraph);
    expect(chunks[0]).not.toContain("B");

    const lastChunk = chunks[chunks.length - 1];

    expect(lastChunk).toContain(secondParagraph);
    expect(lastChunk.startsWith("A")).toBe(true);
  });
});