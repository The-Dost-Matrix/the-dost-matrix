import { describe, expect, it } from "vitest";
import { UsageTracker } from "./usage-tracker";

describe("UsageTracker", () => {
  it("start met lege totalen wanneer er nog geen add() is aangeroepen", () => {
    const tracker = new UsageTracker();

    const totals = tracker.getTotals();

    expect(totals.promptTokens).toBe(0);
    expect(totals.completionTokens).toBe(0);
    expect(totals.totalTokens).toBe(0);
  });

  it("telt meerdere add()-aanroepen correct op", () => {
    const tracker = new UsageTracker();

    tracker.add({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    tracker.add({
      promptTokens: 20,
      completionTokens: 8,
      totalTokens: 28,
    });
    tracker.add({
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    });

    const totals = tracker.getTotals();

    expect(totals.promptTokens).toBe(31);
    expect(totals.completionTokens).toBe(14);
    expect(totals.totalTokens).toBe(45);
  });

  it("laat de totalen ongewijzigd bij een add()-aanroep zonder argument", () => {
    const tracker = new UsageTracker();

    tracker.add({
      promptTokens: 12,
      completionTokens: 3,
      totalTokens: 15,
    });

    expect(() => tracker.add()).not.toThrow();

    const totals = tracker.getTotals();

    expect(totals.promptTokens).toBe(12);
    expect(totals.completionTokens).toBe(3);
    expect(totals.totalTokens).toBe(15);
  });

  it("laat de totalen ongewijzigd bij een add()-aanroep met undefined als usage", () => {
    const tracker = new UsageTracker();

    tracker.add({
      promptTokens: 7,
      completionTokens: 2,
      totalTokens: 9,
    });

    expect(() => tracker.add(undefined)).not.toThrow();

    const totals = tracker.getTotals();

    expect(totals.promptTokens).toBe(7);
    expect(totals.completionTokens).toBe(2);
    expect(totals.totalTokens).toBe(9);
  });

  it("blijft correct optellen na een tussentijdse aanroep zonder usage-gegevens", () => {
    const tracker = new UsageTracker();

    tracker.add({
      promptTokens: 5,
      completionTokens: 5,
      totalTokens: 10,
    });
    tracker.add();
    tracker.add({
      promptTokens: 3,
      completionTokens: 4,
      totalTokens: 7,
    });

    const totals = tracker.getTotals();

    expect(totals.promptTokens).toBe(8);
    expect(totals.completionTokens).toBe(9);
    expect(totals.totalTokens).toBe(17);
  });
});