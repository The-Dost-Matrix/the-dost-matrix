import { describe, expect, it } from "vitest";
import { estimateCost } from "./pricing";

/**
 * Test tegen de daadwerkelijke, geëxporteerde functie estimateCost() —
 * PRICING_BY_MODEL, FALLBACK_PRICING en ModelPricing zijn bewust NIET
 * geëxporteerd door pricing.ts (puur interne implementatiedetails), dus
 * daar wordt hier ook niet rechtstreeks tegen getest.
 */
describe("estimateCost", () => {
  it("berekent de exacte kosten voor een bekend model op basis van de prijstabel", () => {
    // "openai/gpt-4o" staat in de prijstabel: 2.5 USD/1M input, 10 USD/1M output.
    const result = estimateCost("openai/gpt-4o", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(result).toBe(12.5);
  });

  it("valt terug op de fallbackprijs voor een onbekend model", () => {
    const unknownModelResult = estimateCost("dit-model-bestaat-niet-in-de-prijstabel", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    // FALLBACK_PRICING is niet geëxporteerd (puur intern) en komt exact
    // overeen met de prijs van "anthropic/claude-sonnet-5" — vergelijk
    // daarmee in plaats van een privé-constante te importeren.
    const knownEquivalentResult = estimateCost("anthropic/claude-sonnet-5", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(unknownModelResult).toBe(knownEquivalentResult);
    expect(unknownModelResult).toBe(18);
  });

  it("geeft 0 terug bij nul tokengebruik", () => {
    const result = estimateCost("anthropic/claude-sonnet-5", {
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(result).toBe(0);
  });
});
