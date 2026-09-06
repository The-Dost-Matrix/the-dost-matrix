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

  it("keeps content of exactly the chunk length in a single chunk", () => {
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
    const content = makeText(CHUNK_LENGTH * 2 + 1000);

    const chunks = splitConversationIntoChunks(content);

    expect(chunks.length).toBeGreaterThan(1);

    const tailOfFirstChunk = chunks[0].slice(-CHUNK_OVERLAP);

    expect(tailOfFirstChunk).toHaveLength(CHUNK_OVERLAP);
    expect(chunks[1].startsWith(tailOfFirstChunk)).toBe(true);
    expect(chunks[1].slice(0, CHUNK_OVERLAP)).toBe(tailOfFirstChunk);
  });

  it("prefers a paragraph break as split point when it is far enough into the chunk", () => {
    const firstParagraph = "A".repeat(5000);
    const secondParagraph = "B".repeat(3000);
    const content = `${firstParagraph}\n\n${secondParagraph}`;

    const chunks = splitConversationIntoChunks(content);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(firstParagraph);
    expect(chunks[0]).not.toContain("B");
    expect(chunks[1]).toContain(secondParagraph);
    expect(chunks[1].startsWith("A")).toBe(true);
  });
});
const eersteChunk: number = splitConversationIntoChunks("een korte tekst")[0];
