import { describe, expect, it } from "vitest";
import { createUsageTracker } from "./usage-tracker";
import type { ChatCompletionResult } from "./types";

/**
 * Test tegen de daadwerkelijke API: createUsageTracker() (een fabrieksfunctie
 * die een UsageTracker-object teruggeeft — UsageTracker zelf is een
 * interface/type, geen klasse, dus niet aan te roepen met "new"), add() die
 * een volledig ChatCompletionResult verwacht (niet los promptTokens/
 * completionTokens), en totals() (niet getTotals()) met de velden
 * inputTokens/outputTokens/cost.
 */
function completion(
  model: string,
  usage?: ChatCompletionResult["usage"],
): ChatCompletionResult {
  return { content: "", model, usage };
}

describe("createUsageTracker", () => {
  it("start met lege totalen wanneer er nog geen add() is aangeroepen", () => {
    const tracker = createUsageTracker();

    const totals = tracker.totals();

    expect(totals.inputTokens).toBe(0);
    expect(totals.outputTokens).toBe(0);
    expect(totals.cost).toBe(0);
  });

  it("telt meerdere add()-aanroepen correct op", () => {
    const tracker = createUsageTracker();

    tracker.add(completion("anthropic/claude-sonnet-5", { inputTokens: 10, outputTokens: 5 }));
    tracker.add(completion("anthropic/claude-sonnet-5", { inputTokens: 20, outputTokens: 8 }));
    tracker.add(completion("anthropic/claude-sonnet-5", { inputTokens: 1, outputTokens: 1 }));

    const totals = tracker.totals();

    expect(totals.inputTokens).toBe(31);
    expect(totals.outputTokens).toBe(14);
    expect(totals.cost).toBeGreaterThan(0);
  });

  it("laat de totalen ongewijzigd bij een aanroep zonder tokengebruik (bv. een provider die dat niet teruggeeft)", () => {
    const tracker = createUsageTracker();

    tracker.add(completion("anthropic/claude-sonnet-5", { inputTokens: 12, outputTokens: 3 }));
    expect(() => tracker.add(completion("anthropic/claude-sonnet-5"))).not.toThrow();

    const totals = tracker.totals();

    expect(totals.inputTokens).toBe(12);
    expect(totals.outputTokens).toBe(3);
  });

  it("blijft correct optellen na een tussentijdse aanroep zonder tokengebruik", () => {
    const tracker = createUsageTracker();

    tracker.add(completion("anthropic/claude-sonnet-5", { inputTokens: 5, outputTokens: 5 }));
    tracker.add(completion("anthropic/claude-sonnet-5"));
    tracker.add(completion("anthropic/claude-sonnet-5", { inputTokens: 3, outputTokens: 4 }));

    const totals = tracker.totals();

    expect(totals.inputTokens).toBe(8);
    expect(totals.outputTokens).toBe(9);
  });
});
