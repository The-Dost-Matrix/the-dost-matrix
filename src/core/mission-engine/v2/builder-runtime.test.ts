import { describe, expect, it } from "vitest";

import {
  buildTestContextBlock,
  ensureTrailingNewline,
  findMissingContextComplaint,
  isTestFilePath,
  looksLikeSourceCode,
  parsePlannedPaths,
  shouldEditInPlace,
} from "./builder-runtime";

/**
 * Tests voor de fix op de root cause achter vier opeenvolgende kapotte
 * testbestanden (PR #24, #25, #26, #27): de Builder schreef nieuwe
 * testbestanden zonder ooit de broncode te zien die hij moest testen, en
 * zonder een bestaand testbestand als stijl-/frameworkvoorbeeld — met als
 * gevolg verzonnen functienamen en Jest-syntax in een vitest-project.
 *
 * Deze tests raken bewust alleen de twee pure, geëxporteerde functies
 * (isTestFilePath, buildTestContextBlock) en niet de volledige
 * executeBuilderAssignment(): die praat met een echte LLM-provider en de
 * GitHub-client, en het aantoonbaar correct samenstellen van de prompt is
 * hier de kern van de fix — niet het end-to-end GitHub/LLM-verkeer, dat al
 * elders (github-client.test.ts) gedekt wordt.
 */
describe("isTestFilePath", () => {
  it("herkent .test.ts, .test.tsx, .spec.ts en .spec.tsx", () => {
    expect(isTestFilePath("src/core/mission-engine/v2/github/github-client.test.ts")).toBe(true);
    expect(isTestFilePath("src/components/workspace/panel.test.tsx")).toBe(true);
    expect(isTestFilePath("src/utils/helpers.spec.ts")).toBe(true);
    expect(isTestFilePath("src/utils/helpers.spec.tsx")).toBe(true);
  });

  it("herkent .test.js en .test.jsx ook", () => {
    expect(isTestFilePath("scripts/verify-imports.test.js")).toBe(true);
    expect(isTestFilePath("legacy/widget.test.jsx")).toBe(true);
  });

  it("wijst gewone bestanden af, ook als 'test' ergens in het pad voorkomt", () => {
    expect(isTestFilePath("src/core/mission-engine/v2/github/github-client.ts")).toBe(false);
    expect(isTestFilePath("src/testing-utils/helpers.ts")).toBe(false);
    expect(isTestFilePath("docs/test-plan.md")).toBe(false);
  });
});

describe("buildTestContextBlock", () => {
  it("bevat altijd de waarschuwing om nooit functienamen te verzinnen", () => {
    const block = buildTestContextBlock([], null, false);
    expect(block).toContain("Verzin NOOIT een functienaam");
  });

  it("voegt de vitest-instructie alleen toe wanneer usesVitest true is", () => {
    const withVitest = buildTestContextBlock([], null, true);
    const withoutVitest = buildTestContextBlock([], null, false);

    expect(withVitest).toContain("Dit project gebruikt vitest, niet Jest");
    expect(withoutVitest).not.toContain("vitest");
  });

  it("neemt de volledige, daadwerkelijke inhoud van siblingFiles letterlijk op", () => {
    const block = buildTestContextBlock(
      [
        {
          path: "src/core/mission-engine/v2/github/github-client.ts",
          content: "export async function upsertFile() {}",
        },
      ],
      null,
      true,
    );

    expect(block).toContain("src/core/mission-engine/v2/github/github-client.ts");
    expect(block).toContain("export async function upsertFile() {}");
    // De kern van de fix: dit moet de ECHTE code zijn, niet een samenvatting.
    expect(block).not.toContain("createOrUpdateFile");
  });

  it("laat het siblingFiles-gedeelte weg wanneer er geen siblings zijn", () => {
    const block = buildTestContextBlock([], null, true);
    expect(block).not.toContain("andere bestanden uit deze toewijzing");
  });

  it("neemt een exampleTestFile op als stijlvoorbeeld, indien meegegeven", () => {
    const block = buildTestContextBlock([], {
      path: "src/core/mission-engine/v2/director-runtime.test.ts",
      content: "import { describe, it, expect, vi } from \"vitest\";",
    }, true);

    expect(block).toContain("director-runtime.test.ts");
    expect(block).toContain("import { describe, it, expect, vi } from \"vitest\";");
  });

  it("laat het voorbeeldgedeelte weg wanneer er geen exampleTestFile is", () => {
    const block = buildTestContextBlock([], null, true);
    expect(block).not.toContain("Ter referentie");
  });
});

describe("ensureTrailingNewline", () => {
  // Restpunt (7 september 2026): PR #40 en PR #54 leverden allebei een
  // testbestand zonder afsluitende regelovergang op — twee van de twee door
  // de Builder geschreven testbestanden.
  it("voegt een regelovergang toe wanneer die ontbreekt", () => {
    expect(ensureTrailingNewline("export const x = 1;")).toBe("export const x = 1;\n");
  });

  it("laat een bestand dat al goed eindigt ongewijzigd", () => {
    expect(ensureTrailingNewline("export const x = 1;\n")).toBe("export const x = 1;\n");
  });

  it("voegt geen tweede regelovergang toe boven op een al aanwezige", () => {
    const withTrailingNewline = "regel een\nregel twee\n";
    expect(ensureTrailingNewline(withTrailingNewline)).toBe(withTrailingNewline);
  });
});

describe("parsePlannedPaths", () => {
  it("leest een gewone, kommagescheiden lijst", () => {
    expect(parsePlannedPaths("src/a.ts, src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("noemt hetzelfde bestand maar één keer", () => {
    // Dit is de live gevonden oorzaak van een 422 bij GitHub: hetzelfde pad
    // twee keer schrijven binnen één toewijzing.
    expect(parsePlannedPaths("src/a.test.ts, src/a.test.ts")).toEqual(["src/a.test.ts"]);
  });

  it("ziet ./x, /x en x als hetzelfde bestand", () => {
    expect(parsePlannedPaths("./src/a.ts, /src/a.ts, src/a.ts")).toEqual(["src/a.ts"]);
  });

  it("slaat dubbele schuine strepen binnen een pad plat", () => {
    expect(parsePlannedPaths("src//core//a.ts")).toEqual(["src/core/a.ts"]);
  });

  it("negeert lege stukken en overtollige spaties", () => {
    expect(parsePlannedPaths(" src/a.ts , , src/b.ts ,")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("houdt de oorspronkelijke volgorde aan", () => {
    expect(parsePlannedPaths("src/b.ts, src/a.ts")).toEqual(["src/b.ts", "src/a.ts"]);
  });

  it("telt het maximum pas ná het ontdubbelen", () => {
    const line = Array.from({ length: 12 }, (_, index) => `src/a${index % 3}.ts`).join(", ");

    // Twaalf vermeldingen, maar slechts drie verschillende bestanden: die
    // drie moeten er allemaal doorheen komen.
    expect(parsePlannedPaths(line)).toEqual(["src/a0.ts", "src/a1.ts", "src/a2.ts"]);
  });

  it("geeft een lege lijst bij een lege regel", () => {
    expect(parsePlannedPaths("")).toEqual([]);
  });
});

/**
 * Stap 18 (deel 2). Deze functie is één regel, maar legt wel een beleidskeuze
 * vast: vanaf welke omvang een bestaand bestand gericht bewerkt wordt in
 * plaats van overgetypt. Die grens hoort zichtbaar te zijn in een test, zodat
 * hij niet ongemerkt verschuift.
 */
describe("shouldEditInPlace", () => {
  it("schrijft een nieuw bestand altijd in zijn geheel", () => {
    // Er is niets om in te bewerken.
    expect(shouldEditInPlace(null)).toBe(false);
  });

  it("laat een klein bestaand bestand gewoon overtypen", () => {
    // Onder de grens is herschrijven goedkoop en bewezen betrouwbaar; daar
    // levert bewerken alleen een extra faalreden op.
    expect(shouldEditInPlace("x".repeat(1_999))).toBe(false);
  });

  it("bewerkt een bestaand bestand vanaf de grens gericht", () => {
    expect(shouldEditInPlace("x".repeat(2_000))).toBe(true);
    expect(shouldEditInPlace("x".repeat(40_000))).toBe(true);
  });
});

/**
 * De twee blokken hieronder komen uit de live missie van 14 september 2026.
 * Het model weigerde terecht te schrijven omdat het een type miste dat het
 * nooit te zien had gekregen, maar had geen manier om dat te zeggen die wij
 * verstonden — waarna zijn weigering als bestandsinhoud werd weggeschreven.
 */
describe("findMissingContextComplaint", () => {
  it("herkent de afgesproken regel en geeft de toelichting terug", () => {
    const antwoord = "ONVOLDOENDE CONTEXT: ik mis de definitie van MissionAdvanceOutcome.";

    expect(findMissingContextComplaint(antwoord)).toBe(
      "ik mis de definitie van MissionAdvanceOutcome.",
    );
  });

  it("laat lege regels vóór de melding toe", () => {
    expect(findMissingContextComplaint("\n\nONVOLDOENDE CONTEXT: geen type X")).toBe("geen type X");
  });

  it("zwijgt over gewone bestandsinhoud", () => {
    expect(findMissingContextComplaint("export const x = 1;")).toBeNull();
  });

  /**
   * De belangrijkste van de vier: er wordt geen weigering uit proza afgeleid.
   * Zodra je dat doet, haal je vroeg of laat een geldig bestand onderuit
   * omdat er toevallig het woord "ontbreekt" in staat.
   */
  it("leest een klacht in gewone zinnen niet als melding", () => {
    const proza = "De definitie van MissionAdvanceOutcome ontbreekt, dus ik kan niets schrijven.";

    expect(findMissingContextComplaint(proza)).toBeNull();
  });

  it("negeert de markering wanneer die pas halverwege staat", () => {
    // Daar kan hij net zo goed onderdeel van de code of van uitleg zijn.
    const antwoord = ["export const x = 1;", "ONVOLDOENDE CONTEXT: te laat"].join("\n");

    expect(findMissingContextComplaint(antwoord)).toBeNull();
  });
});

describe("looksLikeSourceCode", () => {
  it("herkent gewone broncode", () => {
    expect(looksLikeSourceCode("src/a.ts", "export const x = 1;")).toBe(true);
    expect(looksLikeSourceCode("src/a.ts", "// alleen commentaar")).toBe(true);
    expect(looksLikeSourceCode("src/a.tsx", "import React from 'react';")).toBe(true);
  });

  it("weigert een antwoord in proza", () => {
    // Precies wat er live gebeurde: de weigering van het model werd als
    // .ts-bestand weggeschreven en pas door de importcontrole gestopt.
    const proza = [
      "De daadwerkelijke definitie van MissionAdvanceOutcome ontbreekt.",
      "Lever beide ontbrekende bronnen aan.",
    ].join("\n");

    expect(looksLikeSourceCode("src/domains/missions/mission-labels.ts", proza)).toBe(false);
  });

  it("bemoeit zich niet met andere bestandstypen", () => {
    // Een markdown- of CSS-bestand heeft geen sleutelwoorden, en daar valt
    // dus niets zinnigs over te zeggen.
    expect(looksLikeSourceCode("docs/notitie.md", "Gewoon een zin.")).toBe(true);
    expect(looksLikeSourceCode("src/app/globals.css", "body { color: red; }")).toBe(true);
  });
});
