import { describe, expect, it } from "vitest";

import {
  columnIndexFromReference,
  formatWorksheets,
  parseSharedStrings,
  parseWorksheet,
  resolveWorksheetPaths,
} from "./xlsx-text";

describe("columnIndexFromReference", () => {
  it("rekent kolomletters om naar een positie", () => {
    expect(columnIndexFromReference("A1")).toBe(0);
    expect(columnIndexFromReference("C12")).toBe(2);
    expect(columnIndexFromReference("AA3")).toBe(26);
    expect(columnIndexFromReference("BC100")).toBe(54);
  });
});

describe("parseSharedStrings", () => {
  it("leest de gedeelde tekstentabel, inclusief opgeknipte tekst", () => {
    const xml =
      '<sst count="3">' +
      "<si><t>Missie</t></si>" +
      "<si><t>Kosten &amp; baten</t></si>" +
      "<si><r><t>Half</t></r><r><t>om half</t></r></si>" +
      "</sst>";

    expect(parseSharedStrings(xml)).toEqual([
      "Missie",
      "Kosten & baten",
      "Halfom half",
    ]);
  });

  it("levert een lege lijst wanneer het bestand ontbreekt", () => {
    expect(parseSharedStrings("")).toEqual([]);
  });
});

describe("parseWorksheet", () => {
  const sharedStrings = ["Missie", "Kosten", "gemerged"];

  it("leest verwijzingen naar de gedeelde tekstentabel", () => {
    const xml =
      '<sheetData><row r="1">' +
      '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>' +
      "</row></sheetData>";

    expect(parseWorksheet(xml, sharedStrings)).toEqual([["Missie", "Kosten"]]);
  });

  it("leest tekst die in de cel zelf staat", () => {
    // Zo schrijft openpyxl het; Excel en LibreOffice gebruiken de gedeelde
    // tabel. Beide vormen komen in de praktijk binnen.
    const xml =
      '<sheetData><row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>Stap 25</t></is></c>' +
      "</row></sheetData>";

    expect(parseWorksheet(xml, [])).toEqual([["Stap 25"]]);
  });

  it("houdt lege cellen op hun plaats", () => {
    // Zonder dit schuift "in aanbouw" op naar kolom B, en verandert de
    // betekenis van de rij.
    const xml =
      '<sheetData><row r="3">' +
      '<c r="A3" t="inlineStr"><is><t>Stap 25</t></is></c>' +
      '<c r="C3" t="s"><v>2</v></c>' +
      "</row></sheetData>";

    expect(parseWorksheet(xml, sharedStrings)).toEqual([
      ["Stap 25", "", "gemerged"],
    ]);
  });

  it("leest getallen, booleans en lege cellen", () => {
    const xml =
      '<sheetData><row r="2">' +
      '<c r="A2"><v>0.27</v></c>' +
      '<c r="B2" t="b"><v>1</v></c>' +
      '<c r="C2" t="b"><v>0</v></c>' +
      '<c r="D2" s="4"/>' +
      "</row></sheetData>";

    expect(parseWorksheet(xml, [])).toEqual([["0.27", "WAAR", "ONWAAR", ""]]);
  });
});

describe("resolveWorksheetPaths", () => {
  it("koppelt bladnamen aan hun bestand via de relaties", () => {
    const workbook =
      "<workbook><sheets>" +
      '<sheet name="Kosten" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Notities" sheetId="2" r:id="rId3"/>' +
      "</sheets></workbook>";

    const relationships =
      "<Relationships>" +
      '<Relationship Target="/xl/worksheets/sheet1.xml" Id="rId1"/>' +
      '<Relationship Target="styles.xml" Id="rId2"/>' +
      '<Relationship Target="worksheets/blad-met-eigen-naam.xml" Id="rId3"/>' +
      "</Relationships>";

    // Het tweede blad heet "Notities" maar staat in een bestand met een heel
    // andere naam — dat gebeurt zodra een blad is hernoemd. Afgaan op
    // "sheet2.xml" zou hier het verkeerde bestand inlezen.
    expect(resolveWorksheetPaths(workbook, relationships)).toEqual([
      { name: "Kosten", path: "xl/worksheets/sheet1.xml" },
      { name: "Notities", path: "xl/worksheets/blad-met-eigen-naam.xml" },
    ]);
  });

  it("valt terug op de volgorde wanneer de relaties ontbreken", () => {
    const workbook = '<workbook><sheets><sheet name="Blad1"/></sheets></workbook>';

    expect(resolveWorksheetPaths(workbook, "")).toEqual([
      { name: "Blad1", path: "xl/worksheets/sheet1.xml" },
    ]);
  });
});

describe("formatWorksheets", () => {
  it("zet elk blad onder een eigen kop, met tabs tussen de kolommen", () => {
    const text = formatWorksheets([
      { name: "Kosten", rows: [["Missie", "Bedrag"], ["Stap 19", "0.27"]] },
    ]);

    expect(text).toBe("## Werkblad: Kosten\n\nMissie\tBedrag\nStap 19\t0.27");
  });

  it("slaat een leeg blad over", () => {
    // Een bladnaam zonder inhoud leest als informatie terwijl het er geen is.
    const text = formatWorksheets([
      { name: "Leeg", rows: [] },
      { name: "Gevuld", rows: [["A"]] },
    ]);

    expect(text).toBe("## Werkblad: Gevuld\n\nA");
  });
});
