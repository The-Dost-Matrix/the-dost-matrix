import { describe, expect, it } from "vitest";

import { formatCents } from "./formatCents";

describe("formatCents", () => {
  it("formatteert een geheel bedrag met twee decimalen", () => {
    expect(formatCents(1200)).toBe("€ 12,00");
  });

  it("formatteert een bedrag met centen", () => {
    expect(formatCents(1234)).toBe("€ 12,34");
  });

  it("formatteert nul als '€ 0,00'", () => {
    expect(formatCents(0)).toBe("€ 0,00");
  });

  it("vult centen onder de tien aan tot twee posities", () => {
    expect(formatCents(5)).toBe("€ 0,05");
  });

  it("gebruikt geen duizendtalscheiding bij grote bedragen", () => {
    expect(formatCents(123456)).toBe("€ 1234,56");
  });

  it("zet het minteken vóór het bedrag bij negatieve waarden", () => {
    expect(formatCents(-1234)).toBe("€ -12,34");
  });

  it("rondt fracties van centen af naar de dichtstbijzijnde hele cent", () => {
    expect(formatCents(1234.4)).toBe("€ 12,34");
    expect(formatCents(1234.6)).toBe("€ 12,35");
  });

  it("behandelt niet-eindige invoer als nul", () => {
    expect(formatCents(Number.NaN)).toBe("€ 0,00");
    expect(formatCents(Number.POSITIVE_INFINITY)).toBe("€ 0,00");
  });
});
