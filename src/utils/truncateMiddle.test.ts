import { describe, expect, it } from "vitest";

import { truncateMiddle } from "./truncateMiddle";

describe("truncateMiddle", () => {
  it("geeft de tekst ongewijzigd terug wanneer die niet langer is dan maxLength", () => {
    const value = "korte tekst";

    expect(truncateMiddle(value, value.length)).toBe(value);
    expect(truncateMiddle(value, value.length + 10)).toBe(value);
  });

  it("kort in tot exact maxLength tekens en plaatst het ellipsis-teken in het midden", () => {
    const value = "/Users/dost/projects/matrix/src/core/application/council/council-service.ts";
    const result = truncateMiddle(value, 20);

    expect(result.length).toBe(20);
    expect(result).toContain("…");
  });

  it("geeft het begin het extra teken wanneer er een oneven aantal tekens overblijft", () => {
    const value = "/Users/dost/projects/matrix/src/index.ts";

    // keep = 9, dus start = 5 ('/User') en end = 4 ('x.ts').
    expect(truncateMiddle(value, 10)).toBe("/User…x.ts");
  });

  it("gooit een Error wanneer maxLength kleiner is dan 5", () => {
    expect(() => truncateMiddle("/Users/dost/projects/matrix/src/index.ts", 4)).toThrow(
      "maxLength moet minimaal 5 zijn.",
    );
  });
});
