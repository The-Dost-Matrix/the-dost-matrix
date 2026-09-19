import { describe, expect, it } from "vitest";

import {
  countExecutionNoteMarkers,
  stripExecutionNotes,
} from "./execution-notes";

/**
 * Het geval waar dit vandaan komt, letterlijk zoals het in PR #64 stond. De
 * opmerking is hier opgebouwd uit losse regels in plaats van als blokcommentaar
 * geschreven, omdat een commentaarblok binnen een commentaarblok niet bestaat
 * in TypeScript.
 */
const ECHTE_AANTEKENING = [
  "/**",
  " * Uitvoeringsblokkade: de beschikbare tools kunnen alleen bestanden lezen.",
  " * Niet uitgevoerd: npm test -- src/core/application/knowledge/retrieval.test.ts,",
  " * npm run typecheck, npm test en de Git-diffcontrole. Er is geen PR geopend.",
  " */",
].join("\n");

describe("countExecutionNoteMarkers", () => {
  it("telt de aanwijzingen in de echte aantekening uit PR #64", () => {
    expect(countExecutionNoteMarkers(ECHTE_AANTEKENING)).toBeGreaterThanOrEqual(2);
  });

  it("vindt niets in een gewone opmerking over de code", () => {
    expect(
      countExecutionNoteMarkers("// Deze lus telt de goedgekeurde kennisitems."),
    ).toBe(0);
  });
});

describe("stripExecutionNotes", () => {
  it("haalt de aantekening uit PR #64 weg en laat de rest ongemoeid", () => {
    const bestand = [
      'import { describe } from "vitest";',
      "",
      ECHTE_AANTEKENING,
      "",
      "/** Alle verplichte velden, zonder typecasts. */",
      "function makeEntry() {",
      "  return {};",
      "}",
      "",
    ].join("\n");

    const resultaat = stripExecutionNotes(bestand);

    expect(resultaat.removed).toHaveLength(1);
    expect(resultaat.content).not.toContain("Uitvoeringsblokkade");
    expect(resultaat.content).toContain('import { describe } from "vitest";');
    expect(resultaat.content).toContain("Alle verplichte velden");
    expect(resultaat.content).toContain("function makeEntry() {");
  });

  it("werkt ook wanneer de aantekening uit losse //-regels bestaat", () => {
    const bestand = [
      "const a = 1;",
      "// Uitvoeringsblokkade: de beschikbare tools kunnen alleen lezen.",
      "// Niet uitgevoerd: npm test.",
      "const b = 2;",
      "",
    ].join("\n");

    const resultaat = stripExecutionNotes(bestand);

    expect(resultaat.removed).toHaveLength(1);
    expect(resultaat.content).toBe("const a = 1;\nconst b = 2;\n");
  });

  it("laat een opmerking met precies één aanwijzing staan", () => {
    // Deze zin gaat over de tests en niet over de Builder, maar raakt wél aan
    // een van de aanwijzingen. Eén is bewust te weinig om iets weg te halen:
    // liever een overbodige opmerking laten staan dan een zinvolle wissen.
    const bestand =
      "// Niet uitgevoerd: de trage integratietests, die draaien apart.\nconst a = 1;\n";

    expect(countExecutionNoteMarkers(bestand)).toBe(1);
    expect(stripExecutionNotes(bestand).content).toBe(bestand);
  });

  it("komt niet aan aanwijzingen die in een tekenreeks staan", () => {
    // De verwijdering kijkt alleen naar commentaar dat aan het begin van een
    // regel opent; een `/*` midden in een regel staat vrijwel altijd in tekst.
    const bestand =
      'const melding = "Uitvoeringsblokkade: niet uitgevoerd: van alles";\nconst a = 1;\n';

    expect(stripExecutionNotes(bestand).content).toBe(bestand);
  });

  it("laat een bestand zonder aantekeningen letterlijk ongewijzigd", () => {
    const bestand = [
      'const url = "https://example.com/pad";',
      "",
      "/**",
      " * Geeft het aantal goedgekeurde kennisitems terug.",
      " */",
      "export function telGoedgekeurd(items: { status: string }[]): number {",
      '  return items.filter((item) => item.status === "approved").length;',
      "}",
      "",
    ].join("\n");

    const resultaat = stripExecutionNotes(bestand);

    expect(resultaat.removed).toEqual([]);
    expect(resultaat.content).toBe(bestand);
  });
});
