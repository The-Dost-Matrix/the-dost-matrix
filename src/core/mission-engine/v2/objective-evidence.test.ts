import { describe, expect, it } from "vitest";

import {
  MAX_OBJECTIVE_EVIDENCE_CHARS,
  extractRepositoryPaths,
  formatObjectiveEvidence,
} from "./objective-evidence";

/**
 * Tests bij de vondst van 14 september 2026 (zie objective-evidence.ts).
 *
 * Het zwaartepunt ligt op NIET ophalen. Een pad dat niet in de repository
 * bestaat mag nooit een ophaalpoging worden, en een zin die toevallig op een
 * pad lijkt mag geen bestand worden. Liever een genoemd bestand missen dan
 * iets binnenhalen op goed vertrouwen.
 */

const TREE = [
  "src/core/mission-engine/v2/autonomous-advance.ts",
  "src/domains/missions/mission-labels.ts",
  "src/domains/missions/mission-labels.test.ts",
  "src/app/globals.css",
  "package.json",
];

describe("extractRepositoryPaths", () => {
  it("vindt een pad dat de opdracht letterlijk noemt", () => {
    const objective =
      "Importeer het type uit src/core/mission-engine/v2/autonomous-advance.ts en gebruik het.";

    expect(extractRepositoryPaths(objective, TREE)).toEqual([
      "src/core/mission-engine/v2/autonomous-advance.ts",
    ]);
  });

  it("vindt meerdere paden en houdt de volgorde van noemen aan", () => {
    const objective = [
      "Pas src/domains/missions/mission-labels.ts aan,",
      "kijk daarvoor in src/core/mission-engine/v2/autonomous-advance.ts.",
    ].join(" ");

    expect(extractRepositoryPaths(objective, TREE)).toEqual([
      "src/domains/missions/mission-labels.ts",
      "src/core/mission-engine/v2/autonomous-advance.ts",
    ]);
  });

  it("negeert een pad dat niet in de repository staat", () => {
    // De hele veiligheidsklep: er wordt nooit iets opgehaald op goed
    // vertrouwen. Een verzonnen pad valt hier vanzelf af.
    expect(extractRepositoryPaths("Zie src/verzonnen/bestaat-niet.ts", TREE)).toEqual([]);
  });

  it("negeert gewone tekst die toevallig op een pad lijkt", () => {
    expect(extractRepositoryPaths("Versie 2.5 is klaar, zie hoofdstuk 3.ts erover", TREE)).toEqual(
      [],
    );
  });

  it("herkent een pad met een ./- of @/-voorvoegsel", () => {
    // Zo schrijft een mens het op, en zo staat het in importregels.
    expect(extractRepositoryPaths("zie @/domains/missions/mission-labels.ts", TREE)).toEqual([
      "src/domains/missions/mission-labels.ts",
    ]);
  });

  it("noemt hetzelfde bestand niet twee keer", () => {
    const objective = "package.json aanpassen; controleer daarna package.json opnieuw.";

    expect(extractRepositoryPaths(objective, TREE)).toEqual(["package.json"]);
  });

  it("houdt zich aan de bovengrens", () => {
    const objective = TREE.join(" en ");

    expect(extractRepositoryPaths(objective, TREE, 2)).toHaveLength(2);
  });

  it("geeft een lege lijst bij een opdracht zonder paden", () => {
    expect(extractRepositoryPaths("Maak de knop groen.", TREE)).toEqual([]);
  });
});

describe("formatObjectiveEvidence", () => {
  it("geeft niets terug wanneer er geen bestanden zijn", () => {
    expect(formatObjectiveEvidence([])).toBe("");
  });

  it("zet het pad en de inhoud in het blok", () => {
    const blok = formatObjectiveEvidence([{ path: "package.json", content: '{"naam":"test"}' }]);

    expect(blok).toContain("package.json");
    expect(blok).toContain('{"naam":"test"}');
  });

  it("zegt er expliciet bij dat deze bestanden niet geschreven worden", () => {
    // Zonder die zin is de kans reëel dat het model ze óók gaat aanpassen, en
    // dan staat er een bestand in de pull request dat er niet hoort.
    const blok = formatObjectiveEvidence([{ path: "package.json", content: "{}" }]);

    expect(blok).toContain("alleen om te lezen");
    expect(blok).toContain("NIET door jou geschreven");
  });

  it("kapt een heel groot bestand af", () => {
    const blok = formatObjectiveEvidence([
      { path: "src/app/globals.css", content: "x".repeat(MAX_OBJECTIVE_EVIDENCE_CHARS + 500) },
    ]);

    expect(blok).not.toContain("x".repeat(MAX_OBJECTIVE_EVIDENCE_CHARS + 1));
  });

  /**
   * Regressietest bij de reparatie van 20 september 2026.
   *
   * Een live missie strandde omdat een genoemd testbestand van 11.352 tekens
   * op 6.000 werd afgekapt — zonder melding, en mét de zin erboven dat dit de
   * volledige huidige inhoud was. De Builder zag een bestand dat midden in een
   * test ophield en weigerde te schrijven, precies zoals hij hoort te doen.
   *
   * De grens is verhoogd, maar dat is de minst belangrijke helft: zolang
   * afkappen stil gebeurt, komt ditzelfde probleem bij een groter bestand
   * gewoon terug.
   */
  it("meldt het hardop wanneer er iets is afgekapt, met beide aantallen", () => {
    const lengte = MAX_OBJECTIVE_EVIDENCE_CHARS + 500;
    const blok = formatObjectiveEvidence([
      { path: "src/groot.test.ts", content: "x".repeat(lengte) },
    ]);

    expect(blok).toContain("LET OP");
    expect(blok).toContain(String(MAX_OBJECTIVE_EVIDENCE_CHARS));
    expect(blok).toContain(String(lengte));
    expect(blok).toContain("lees_bestand");
  });

  it("zwijgt over afkappen wanneer er niets is afgekapt", () => {
    // Anders leest elk normaal bestand als een waarschuwing, en dan wordt de
    // waarschuwing bij het ene bestand dat hem wél verdient niet meer gezien.
    const blok = formatObjectiveEvidence([{ path: "src/klein.ts", content: "kort" }]);

    expect(blok).not.toContain("LET OP");
    expect(blok).toContain("--- einde ---");
  });

  it("is ruim genoeg voor het bestand waarop de live missie strandde", () => {
    // mission-duration.test.ts was 11.352 tekens.
    expect(MAX_OBJECTIVE_EVIDENCE_CHARS).toBeGreaterThan(11_352);
  });
});
