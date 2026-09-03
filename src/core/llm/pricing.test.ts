import { describe, expect, it } from "vitest";
import {
  FALLBACK_PRICING,
  MODEL_PRICING,
  getModelPricing,
} from "./pricing";

describe("pricing", () => {
  describe("getModelPricing", () => {
    it("geeft de exacte prijstabel-waarden terug voor een bekend model", () => {
      const knownModels = Object.keys(MODEL_PRICING);
      expect(knownModels.length).toBeGreaterThan(0);

      const knownModel = knownModels[0];
      const expected = MODEL_PRICING[knownModel];

      const result = getModelPricing(knownModel);

      expect(result).toEqual(expected);
    });

    it("valt terug op de fallbackprijs voor een onbekend model", () => {
      const unknownModel = "this-model-does-not-exist-in-pricing-table";

      expect(MODEL_PRICING[unknownModel]).toBeUndefined();

      const result = getModelPricing(unknownModel);

      expect(result).toEqual(FALLBACK_PRICING);
    });
  });
});