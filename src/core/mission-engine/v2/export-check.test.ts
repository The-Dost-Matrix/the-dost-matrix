import { describe, expect, it } from "vitest";

import {
  describeUnknownImports,
  extractExportedNames,
  extractNamedImports,
  findUnknownImports,
} from "./export-check";

/**
 * Tests bij stap 18 (deel 3).
 *
 * Het zwaartepunt ligt hier niet op het vinden van een verzonnen import — dat
 * is het makkelijke deel. Het ligt op ZWIJGEN bij twijfel. Een onterecht
 * geblokkeerde toewijzing kost een hele ronde en ondermijnt het vertrouwen in
 * de controle; een gemiste verzonnen import wordt alsnog door de CI gevangen.
 * Daarom staan er hieronder meer tests over overslaan dan over afkeuren.
 */

/**
 * Importregels uit stukken opbouwen, net als in context-resolver.test.ts:
 * scripts/verify-imports.mjs leest élk bestand in src/ en zou een letterlijke
 * voorbeeldregel hier aanzien voor een echte import van dit testbestand.
 */
function importLine(clause: string, specifier: string): string {
  return ["import", clause, "from", `"${specifier}";`].join(" ");
}

function exportFromLine(clause: string, specifier: string): string {
  return ["export", clause, "from", `"${specifier}";`].join(" ");
}

describe("extractNamedImports", () => {
  it("haalt benoemde imports eruit, inclusief type-imports", () => {
    const source = [
      importLine("{ a, b }", "./x"),
      importLine("type { Vorm }", "./y"),
    ].join("\n");

    expect(extractNamedImports(source)).toEqual([
      { specifier: "./x", names: ["a", "b"] },
      { specifier: "./y", names: ["Vorm"] },
    ]);
  });

  it("controleert bij een alias de naam zoals die in het doelbestand staat", () => {
    // `import { origineel as lokaal }` betekent dat "origineel" moet bestaan,
    // niet "lokaal".
    expect(extractNamedImports(importLine("{ origineel as lokaal }", "./x"))).toEqual([
      { specifier: "./x", names: ["origineel"] },
    ]);
  });

  it("negeert default- en namespace-imports", () => {
    // Die zijn niet op naam te controleren, dus er valt niets over te zeggen.
    expect(extractNamedImports(importLine("Standaard", "./x"))).toEqual([]);
    expect(extractNamedImports(importLine("* as alles", "./x"))).toEqual([]);
  });

  it("pikt de benoemde helft van een gemengde import mee", () => {
    expect(extractNamedImports(importLine("Standaard, { hulp }", "./x"))).toEqual([
      { specifier: "./x", names: ["hulp"] },
    ]);
  });

  it("negeert een import die is uitgecommentarieerd", () => {
    expect(extractNamedImports(`// ${importLine("{ weg }", "./x")}`)).toEqual([]);
  });

  it("voegt twee imports uit hetzelfde bestand samen", () => {
    const source = [importLine("{ a }", "./x"), importLine("type { B }", "./x")].join("\n");

    expect(extractNamedImports(source)).toEqual([{ specifier: "./x", names: ["a", "B"] }]);
  });
});

describe("extractExportedNames", () => {
  it("herkent de gewone declaratievormen", () => {
    const source = [
      "export function doeIets() {}",
      "export async function doeMeer() {}",
      "export const WAARDE = 1;",
      "export class Ding {}",
      "export interface Vorm {}",
      "export type Alias = string;",
      "export enum Soort {}",
    ].join("\n");

    expect(extractExportedNames(source).names).toEqual([
      "doeIets",
      "doeMeer",
      "WAARDE",
      "Ding",
      "Vorm",
      "Alias",
      "Soort",
    ]);
  });

  it("gebruikt bij een alias de naam waaronder hij naar buiten komt", () => {
    // Precies andersom als bij imports: `export { intern as extern }` maakt
    // "extern" beschikbaar voor de buitenwereld.
    expect(extractExportedNames("export { intern as extern };").names).toEqual(["extern"]);
  });

  it("telt een re-export als een eigen naam", () => {
    expect(extractExportedNames(exportFromLine("{ RoleResult }", "./role-result")).names).toEqual([
      "RoleResult",
    ]);
  });

  it("markeert de lijst als onvolledig bij een sterretje-export", () => {
    // Dit is de belangrijkste: afwezigheid van een naam bewijst hier niets.
    const exports = extractExportedNames(exportFromLine("*", "./alles"));

    expect(exports.complete).toBe(false);
  });

  it("markeert een gewoon bestand als volledig", () => {
    expect(extractExportedNames("export const x = 1;").complete).toBe(true);
  });

  /**
   * Gevonden door deze controle los te laten op de eigen codebase, vóór
   * oplevering: `src/core/workflows/types.ts` begint met een onzichtbaar
   * BOM-teken, en daardoor werd zijn eerste export (`WorkflowRole`) niet
   * gezien. Drie bestanden die die naam importeren kwamen zo onterecht als
   * fout uit de controle — precies het valse alarm dat deze module hoort te
   * vermijden.
   */
  it("ziet de eerste export ook wanneer het bestand met een BOM begint", () => {
    expect(extractExportedNames("﻿export type WorkflowRole = string;").names).toEqual([
      "WorkflowRole",
    ]);
  });
});

describe("findUnknownImports", () => {
  const treeSources: Record<string, string> = {
    "src/utils/helpers.ts": "export function bestaat() {}\nexport const OOK = 1;",
    "src/utils/barrel.ts": exportFromLine("*", "./helpers"),
    "src/utils/leeg.ts": "const intern = 1;",
  };

  const resolve = (fromPath: string, specifier: string) => {
    if (specifier === "./helpers") return "src/utils/helpers.ts";
    if (specifier === "./barrel") return "src/utils/barrel.ts";
    if (specifier === "./leeg") return "src/utils/leeg.ts";
    if (specifier === "./onbekend") return "src/utils/onbekend.ts";
    return null;
  };

  const readSource = (path: string) => treeSources[path] ?? null;

  it("meldt een naam die nergens geëxporteerd wordt", () => {
    const problems = findUnknownImports({
      path: "src/utils/nieuw.ts",
      source: importLine("{ verzonnen }", "./helpers"),
      resolve,
      readSource,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].missingNames).toEqual(["verzonnen"]);
    expect(problems[0].availableNames).toEqual(["bestaat", "OOK"]);
  });

  it("zwijgt over een naam die wél bestaat", () => {
    expect(
      findUnknownImports({
        path: "src/utils/nieuw.ts",
        source: importLine("{ bestaat }", "./helpers"),
        resolve,
        readSource,
      }),
    ).toEqual([]);
  });

  it("zwijgt over een pakket buiten deze repository", () => {
    expect(
      findUnknownImports({
        path: "src/utils/nieuw.ts",
        source: importLine("{ describe }", "vitest"),
        resolve,
        readSource,
      }),
    ).toEqual([]);
  });

  it("zwijgt wanneer het doelbestand een sterretje-export bevat", () => {
    // De namenlijst is daar onvolledig, dus afwezigheid bewijst niets.
    expect(
      findUnknownImports({
        path: "src/utils/nieuw.ts",
        source: importLine("{ vanAchterDeBarrel }", "./barrel"),
        resolve,
        readSource,
      }),
    ).toEqual([]);
  });

  it("zwijgt wanneer de inhoud van het doelbestand niet beschikbaar is", () => {
    expect(
      findUnknownImports({
        path: "src/utils/nieuw.ts",
        source: importLine("{ vanalles }", "./onbekend"),
        resolve,
        readSource,
      }),
    ).toEqual([]);
  });

  it("meldt het wél wanneer een bestand niets exporteert", () => {
    // Leeg is iets anders dan onbekend: hier weten we het zeker.
    const problems = findUnknownImports({
      path: "src/utils/nieuw.ts",
      source: importLine("{ iets }", "./leeg"),
      resolve,
      readSource,
    });

    expect(problems).toHaveLength(1);
    expect(problems[0].availableNames).toEqual([]);
  });
});

describe("describeUnknownImports", () => {
  it("noemt zowel wat ontbreekt als wat er wél is", () => {
    // Zonder die tweede helft weet de herstelpoging nog steeds niet wat hij
    // dan wél moet gebruiken.
    const melding = describeUnknownImports([
      {
        fromPath: "src/utils/nieuw.ts",
        specifier: "./helpers",
        targetPath: "src/utils/helpers.ts",
        missingNames: ["verzonnen"],
        availableNames: ["bestaat", "OOK"],
      },
    ]);

    expect(melding).toContain("verzonnen");
    expect(melding).toContain("src/utils/helpers.ts");
    expect(melding).toContain("bestaat, OOK");
  });
});
