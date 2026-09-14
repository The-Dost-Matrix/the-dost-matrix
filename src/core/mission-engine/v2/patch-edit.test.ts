import { describe, expect, it } from "vitest";

import {
  applyEditBlocks,
  applyEditResponse,
  containsEditBlocks,
  parseEditBlocks,
  PatchEditError,
} from "./patch-edit";

/**
 * Tests bij stap 18 (deel 2).
 *
 * De kern van deze stap is niet dat bewerken werkt, maar dat het op de juiste
 * manier MISLUKT. Een hele-bestand-herschrijving die onderweg iets laat vallen
 * ziet er compleet uit; daar zit geen signaal in. Een bewerking die niet past,
 * hoort luid te stoppen — en nooit half toegepast te worden.
 */

/**
 * De markeringen worden hier uit stukken opgebouwd in plaats van als één
 * letterlijke regel. Dat houdt de testinvoer leesbaar naast de blokken die de
 * functies zelf teruggeven, en voorkomt dat een half blok in dit bestand op
 * een echt blok lijkt.
 */
function editBlock(search: string, replace: string): string {
  return ["<<<<<<< ZOEK", search, "=======", replace, ">>>>>>> VERVANG"].join("\n");
}

const SOURCE = [
  "export function begroet(naam: string): string {",
  "  return `Hallo ${naam}`;",
  "}",
].join("\n");

describe("containsEditBlocks", () => {
  it("herkent een antwoord met bewerkingsblokken", () => {
    expect(containsEditBlocks(editBlock("a", "b"))).toBe(true);
  });

  it("herkent gewone bestandsinhoud niet als bewerking", () => {
    expect(containsEditBlocks(SOURCE)).toBe(false);
  });
});

describe("parseEditBlocks", () => {
  it("leest één blok", () => {
    expect(parseEditBlocks(editBlock("oud", "nieuw"))).toEqual([
      { search: "oud", replace: "nieuw" },
    ]);
  });

  it("leest meerdere blokken uit hetzelfde antwoord", () => {
    const response = [editBlock("een", "1"), editBlock("twee", "2")].join("\n\n");

    expect(parseEditBlocks(response)).toEqual([
      { search: "een", replace: "1" },
      { search: "twee", replace: "2" },
    ]);
  });

  /**
   * De vier tests hieronder komen uit een live missie die vier pogingen
   * achter elkaar strandde op "het antwoord bevat geen enkel bewerkingsblok"
   * (14 september 2026), op een bestand waar de missie ervóór wél in slaagde.
   * Alle vier beschrijven ze een antwoord dat inhoudelijk prima is en alleen
   * op de vorm van de markering afweek.
   */
  it("accepteert de Engelse markeringen waar modellen op getraind zijn", () => {
    const response = ["<<<<<<< SEARCH", "oud", "=======", "nieuw", ">>>>>>> REPLACE"].join("\n");

    expect(parseEditBlocks(response)).toEqual([{ search: "oud", replace: "nieuw" }]);
  });

  it("accepteert ingesprongen markeringen", () => {
    // Gebeurt zodra het model zijn antwoord in een codeblok zet.
    const response = ["   <<<<<<< ZOEK", "oud", "   =======", "nieuw", "   >>>>>>> VERVANG"].join(
      "\n",
    );

    expect(parseEditBlocks(response)).toEqual([{ search: "oud", replace: "nieuw" }]);
  });

  it("let niet op hoofdletters in het markeringswoord", () => {
    const response = ["<<<<<<< zoek", "oud", "=======", "nieuw", ">>>>>>> Vervang"].join("\n");

    expect(parseEditBlocks(response)).toEqual([{ search: "oud", replace: "nieuw" }]);
  });

  /**
   * De tegenhanger van die soepelheid: de scheidingsregel blijft streng. Zou
   * een regel als `// ===== sectie =====` ook als scheiding tellen, dan hakt
   * een commentaarbalk midden in een zoekfragment het blok in tweeën — en dan
   * gaat er iets stuk dat er wél goed uitzag.
   */
  it("ziet een commentaarbalk niet aan voor de scheidingsregel", () => {
    const response = [
      "<<<<<<< ZOEK",
      "// ===== sectie =====",
      "const b = 2;",
      "=======",
      "const b = 99;",
      ">>>>>>> VERVANG",
    ].join("\n");

    expect(parseEditBlocks(response)).toEqual([
      { search: "// ===== sectie =====\nconst b = 2;", replace: "const b = 99;" },
    ]);
  });

  it("negeert tekst buiten de blokken", () => {
    // Modellen schrijven graag een inleidende zin. In de hele-bestand-modus
    // belandt die ín het bestand; hier kan hij geen kwaad, dus streng zijn zou
    // alleen een extra faalreden opleveren zonder winst.
    const response = [
      "Ik pas de begroeting aan:",
      editBlock("oud", "nieuw"),
      "Klaar!",
    ].join("\n");

    expect(parseEditBlocks(response)).toEqual([{ search: "oud", replace: "nieuw" }]);
  });

  it("leest een leeg vervangdeel als verwijdering", () => {
    expect(parseEditBlocks(editBlock("weg hiermee", ""))).toEqual([
      { search: "weg hiermee", replace: "" },
    ]);
  });

  it("behoudt meerregelige fragmenten precies", () => {
    const search = ["  if (x) {", "    doeIets();", "  }"].join("\n");

    expect(parseEditBlocks(editBlock(search, "  doeIets();"))[0].search).toBe(search);
  });

  it("weigert een antwoord zonder blokken", () => {
    expect(() => parseEditBlocks("Hier is de nieuwe inhoud van het bestand.")).toThrow(
      PatchEditError,
    );
  });
});

describe("applyEditBlocks", () => {
  it("vervangt het gevonden fragment", () => {
    const result = applyEditBlocks(SOURCE, [
      { search: "`Hallo ${naam}`", replace: "`Hoi ${naam}`" },
    ]);

    expect(result).toContain("Hoi");
    expect(result).not.toContain("Hallo");
  });

  it("laat alles wat niet genoemd is ongemoeid", () => {
    // Dit is de hele winst ten opzichte van herschrijven: wat het model niet
    // noemt, kan het ook niet kwijtraken.
    const result = applyEditBlocks(SOURCE, [
      { search: "`Hallo ${naam}`", replace: "`Hoi ${naam}`" },
    ]);

    expect(result).toContain("export function begroet(naam: string): string {");
    expect(result.split("\n")).toHaveLength(SOURCE.split("\n").length);
  });

  it("past meerdere bewerkingen na elkaar toe", () => {
    const result = applyEditBlocks(SOURCE, [
      { search: "begroet", replace: "groet" },
      { search: "Hallo", replace: "Hoi" },
    ]);

    expect(result).toContain("export function groet(");
    expect(result).toContain("Hoi");
  });

  it("verwijdert bij een leeg vervangdeel", () => {
    const result = applyEditBlocks("regel een\nregel twee\n", [
      { search: "regel een\n", replace: "" },
    ]);

    expect(result).toBe("regel twee\n");
  });

  it("stopt wanneer het fragment niet voorkomt, met de begintekst erbij", () => {
    expect(() =>
      applyEditBlocks(SOURCE, [{ search: "bestaat helemaal niet", replace: "x" }]),
    ).toThrow(/komt niet voor/);
  });

  it("stopt wanneer het fragment meerdere keren voorkomt", () => {
    // "dan maar de eerste" is raden, en raden is precies wat deze stap moet
    // uitbannen.
    expect(() =>
      applyEditBlocks("herhaal\nherhaal\n", [{ search: "herhaal", replace: "x" }]),
    ).toThrow(/2 keer voor/);
  });

  it("stopt bij een leeg zoekfragment", () => {
    expect(() => applyEditBlocks(SOURCE, [{ search: "", replace: "x" }])).toThrow(
      /leeg zoekfragment/,
    );
  });

  it("past niets toe wanneer een later blok mislukt", () => {
    // Alles of niets: een half bewerkt bestand is erger dan een onbewerkt
    // bestand, want het ziet er compleet uit.
    let result: string | null = null;

    try {
      result = applyEditBlocks(SOURCE, [
        { search: "begroet", replace: "groet" },
        { search: "bestaat niet", replace: "x" },
      ]);
    } catch {
      // verwacht
    }

    expect(result).toBeNull();
  });

  it("neemt vervangtekst met dollartekens letterlijk", () => {
    // `$&` betekent in een gewone JavaScript-vervanging "de gevonden tekst".
    // Zonder de functievorm zou code met zo'n reeks stilzwijgend iets anders
    // worden dan het model bedoelde.
    const result = applyEditBlocks("const prijs = TODO;", [
      { search: "TODO", replace: "`$& en $1`" },
    ]);

    expect(result).toBe("const prijs = `$& en $1`;");
  });
});

describe("applyEditResponse", () => {
  it("leest en past in één keer toe", () => {
    const response = editBlock("`Hallo ${naam}`", "`Goedemorgen ${naam}`");

    expect(applyEditResponse(SOURCE, response)).toContain("Goedemorgen");
  });

  it("geeft een PatchEditError door wanneer het antwoord geen blok bevat", () => {
    expect(() => applyEditResponse(SOURCE, "zomaar tekst")).toThrow(PatchEditError);
  });
});
