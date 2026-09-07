import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

/**
 * De LLM-provider wordt volledig nagebootst: `reviewKnowledgeEntry` haalt zijn
 * provider op via `getChatProvider()` uit "@/core/llm/model-router", dus door
 * die module te mocken raakt geen enkele test het netwerk.
 *
 * `reviewer.ts` roept `provider.chatCompletion(systemPrompt, messages)` aan en
 * leest uit het resultaat uitsluitend `result.content` en `result.model`.
 * De mock geeft daarom exact die vorm terug: `{ content, model }`.
 */
const chatCompletion = vi.fn();

vi.mock("@/core/llm/model-router", () => ({
  getChatProvider: () => ({ chatCompletion }),
}));

import { reviewKnowledgeEntry } from "./reviewer";

const MODEL = "claude-sonnet-4-20250514";

/** Antwoord van de provider, in exact de vorm die `reviewer.ts` uitleest. */
function providerResponse(content: string): { content: string; model: string } {
  return { content, model: MODEL };
}

/**
 * Een volledig, geldig KnowledgeEntry: alle verplichte velden uit
 * `KnowledgeEntry` (id, ownerId, content, source, tags, embedding, createdAt)
 * plus de optionele velden die de reviewer daadwerkelijk meestuurt.
 */
function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "knw_01HZX4M2K9QW3T7B5N8R6V0PDA",
    ownerId: "usr_01HZX4M2K9QW3T7B5N8R6V0PDB",
    type: "architecture",
    title: "Model Router kiest Anthropic vóór OpenAI",
    summary:
      "De chatprovider wordt bepaald door de aanwezige API-sleutels, met Anthropic als voorkeur.",
    content:
      "De Model Router selecteert de chatprovider op basis van de geconfigureerde API-sleutels. " +
      "Wanneer ANTHROPIC_API_KEY aanwezig is wordt Anthropic gebruikt, anders OpenAI. " +
      "Ontbreken beide sleutels, dan faalt de aanroep expliciet in plaats van stil terug te vallen.",
    project: "The Dost Matrix",
    lifecycle: "foundation",
    source: "chat",
    sourceDocument: "architectuurnotitie-model-router.md",
    sourceSection: "Providerselectie",
    status: "pending",
    confidence: 0.82,
    tags: ["architectuur", "llm", "model-router"],
    embedding: [],
    createdAt: new Date("2025-01-15T10:00:00.000Z"),
    ...overrides,
  };
}

describe("reviewKnowledgeEntry", () => {
  beforeEach(() => {
    chatCompletion.mockReset();
  });

  it("parses a response that is wrapped in markdown code fences", async () => {
    chatCompletion.mockResolvedValue(
      providerResponse(
        [
          "```json",
          JSON.stringify({
            recommendation: "approve",
            confidence: 0.9,
            reason: "Beschrijft een blijvend architectuurbesluit.",
            issues: [],
          }),
          "```",
        ].join("\n"),
      ),
    );

    const review = await reviewKnowledgeEntry(makeEntry());

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(review.recommendation).toBe("approve");
    expect(review.confidence).toBe(0.9);
    expect(review.reason).toBe("Beschrijft een blijvend architectuurbesluit.");
    expect(review.issues).toEqual([]);
    expect(review.suggestedTitle).toBeUndefined();
    expect(review.suggestedContent).toBeUndefined();
    expect(review.model).toBe(MODEL);
    expect(review.reviewedAt).toBeInstanceOf(Date);
  });

  it("passes the system prompt and the entry as a user message to the provider", async () => {
    chatCompletion.mockResolvedValue(
      providerResponse(
        JSON.stringify({
          recommendation: "approve",
          confidence: 0.7,
          reason: "Zelfstandig begrijpelijk en duurzaam.",
          issues: [],
        }),
      ),
    );

    const entry = makeEntry();

    await reviewKnowledgeEntry(entry);

    const [systemPrompt, messages] = chatCompletion.mock.calls[0];

    expect(typeof systemPrompt).toBe("string");
    expect(systemPrompt).toContain("Knowledge Review Agent");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain(entry.content);
    expect(messages[0].content).toContain(entry.title);
  });

  it("throws when the provider returns invalid JSON", async () => {
    chatCompletion.mockResolvedValue(
      providerResponse("Dit is geen JSON maar gewone tekst."),
    );

    await expect(reviewKnowledgeEntry(makeEntry())).rejects.toThrowError(
      "De Review Agent gaf geen geldige JSON terug.",
    );
  });

  it("rejects an 'edit' recommendation without suggestedContent", async () => {
    chatCompletion.mockResolvedValue(
      providerResponse(
        JSON.stringify({
          recommendation: "edit",
          confidence: 0.6,
          reason: "De titel is tijdgebonden geformuleerd.",
          issues: ["Bevat een versienummer zonder blijvende betekenis."],
          suggestedTitle: "Providerselectie in de Model Router",
        }),
      ),
    );

    await expect(reviewKnowledgeEntry(makeEntry())).rejects.toThrowError(
      "De Review Agent adviseerde bewerken, maar gaf geen volledig tekstvoorstel terug.",
    );
  });

  it("rejects an 'edit' recommendation without suggestedTitle", async () => {
    chatCompletion.mockResolvedValue(
      providerResponse(
        JSON.stringify({
          recommendation: "edit",
          confidence: 0.6,
          reason: "De inhoud kan tijdlozer geformuleerd worden.",
          issues: [],
          suggestedContent:
            "De Model Router kiest Anthropic wanneer ANTHROPIC_API_KEY is gezet en anders OpenAI.",
        }),
      ),
    );

    await expect(reviewKnowledgeEntry(makeEntry())).rejects.toThrowError(
      "De Review Agent adviseerde bewerken, maar gaf geen volledig tekstvoorstel terug.",
    );
  });

  it("accepts an 'edit' recommendation with a complete text proposal", async () => {
    chatCompletion.mockResolvedValue(
      providerResponse(
        JSON.stringify({
          recommendation: "edit",
          confidence: 0.65,
          reason: "Kern is waardevol, formulering kan tijdlozer.",
          issues: ["Titel is te specifiek."],
          suggestedTitle: "  Providerselectie in de Model Router  ",
          suggestedContent:
            "  De Model Router kiest Anthropic wanneer ANTHROPIC_API_KEY is gezet en anders OpenAI.  ",
        }),
      ),
    );

    const review = await reviewKnowledgeEntry(makeEntry());

    expect(review.recommendation).toBe("edit");
    expect(review.suggestedTitle).toBe("Providerselectie in de Model Router");
    expect(review.suggestedContent).toBe(
      "De Model Router kiest Anthropic wanneer ANTHROPIC_API_KEY is gezet en anders OpenAI.",
    );
    expect(review.issues).toEqual(["Titel is te specifiek."]);
  });

  it("clamps a confidence above 1 down to 1", async () => {
    chatCompletion.mockResolvedValue(
      providerResponse(
        JSON.stringify({
          recommendation: "approve",
          confidence: 4.2,
          reason: "Duidelijk en duurzaam architectuurbesluit.",
          issues: [],
        }),
      ),
    );

    const review = await reviewKnowledgeEntry(makeEntry());

    expect(review.confidence).toBe(1);
  });

  it("clamps a confidence below 0 up to 0", async () => {
    chatCompletion.mockResolvedValue(
      providerResponse(
        JSON.stringify({
          recommendation: "reject",
          confidence: -3,
          reason: "Bestaat hoofdzakelijk uit installatie-instructies.",
          issues: ["Geen blijvende informatiewaarde."],
        }),
      ),
    );

    const review = await reviewKnowledgeEntry(makeEntry());

    expect(review.confidence).toBe(0);
    expect(review.recommendation).toBe("reject");
  });
});