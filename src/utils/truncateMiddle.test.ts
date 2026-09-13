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

  /**
   * Toegevoegd na de geautomatiseerde beoordeling van pull request #59. Die
   * wees erop dat `maxLength` een `number` is en 5.5 dus ongehinderd door de
   * controle hierboven kwam — met een resultaat van zes tekens als gevolg,
   * terwijl de functie belooft altijd exact `maxLength` tekens terug te geven.
   */
  it("gooit een Error wanneer maxLength geen geheel getal is", () => {
    expect(() => truncateMiddle("/Users/dost/projects/matrix/src/index.ts", 5.5)).toThrow(
      "maxLength moet een geheel getal zijn.",
    );
  });

  it("geeft bij elke geldige lengte een resultaat van exact die lengte", () => {
    // De belofte uit de documentatie, nu mechanisch nagelopen in plaats van
    // op één voorbeeld gecontroleerd.
    const value = "/Users/dost/projects/matrix/src/core/application/council/council-service.ts";

    for (let maxLength = 5; maxLength <= 40; maxLength += 1) {
      expect(truncateMiddle(value, maxLength)).toHaveLength(maxLength);
    }
  });
});
