import { describe, expect, it } from "vitest";

import { joinTextItems } from "./pdf-text";

/**
 * Alleen het samenvoegen wordt hier getest, niet pdf.js zelf. Dat is bewust:
 * pdf.js draait in een browserwerker en meetesten zou betekenen dat er een
 * browseromgeving aan vitest gehangen wordt om een bibliotheek te
 * controleren die niet van ons is. Het stuk waar de fouten in zitten — hoe
 * losse tekststukjes weer regels worden — is gewone functietekst en wordt
 * hier wel gedekt.
 */
describe("joinTextItems", () => {
  it("plakt stukjes binnen een regel aan elkaar", () => {
    const items = [
      { str: "De Dost ", hasEOL: false },
      { str: "Matrix", hasEOL: true },
    ];

    expect(joinTextItems(items)).toBe("De Dost Matrix");
  });

  it("begint een nieuwe regel waar de PDF er een aangeeft", () => {
    const items = [
      { str: "Eerste regel", hasEOL: true },
      { str: "Tweede regel", hasEOL: true },
    ];

    expect(joinTextItems(items)).toBe("Eerste regel\nTweede regel");
  });

  it("neemt de laatste regel mee ook zonder afsluitende regelovergang", () => {
    // Dit gebeurt op vrijwel elke bladzijde: het laatste stukje heeft geen
    // regelovergang meer. Zonder deze afhandeling raak je per bladzijde een
    // regel kwijt, en dat valt in een lang document niemand op.
    const items = [
      { str: "Eerste", hasEOL: true },
      { str: "Laatste zonder overgang", hasEOL: false },
    ];

    expect(joinTextItems(items)).toBe("Eerste\nLaatste zonder overgang");
  });

  it("slaat stukjes zonder tekst over", () => {
    // pdf.js levert naast tekst ook opmaakmarkeringen aan; die hebben geen
    // `str` en mogen de regelopbouw niet verstoren.
    const items = [
      { str: "Tekst" },
      { type: "beginMarkedContent", id: "p1" },
      { str: " erachter", hasEOL: true },
    ];

    expect(joinTextItems(items)).toBe("Tekst erachter");
  });

  it("levert een lege tekenreeks bij een bladzijde zonder letters", () => {
    // Een ingescande bladzijde: wel een afbeelding, geen tekst.
    expect(joinTextItems([])).toBe("");
  });
});
