import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  MAX_PARSED_TEXT_LENGTH,
  applyLengthLimit,
  parseDocumentFile,
} from "./parse-document";

/**
 * Deze tests bouwen een échte DOCX en XLSX op — een ZIP met dezelfde
 * onderdelen als Word en Excel erin zetten — en halen die er via de gewone
 * weg weer uit. Daarmee wordt niet alleen de tekstextractie gedekt maar ook
 * het uitpakken en het vinden van de juiste onderdelen, en dat is precies het
 * stuk dat je met losse XML-fragmenten niet te pakken krijgt.
 */

function zipToBlob(files: Record<string, string>): Blob {
  const entries: Record<string, Uint8Array> = {};

  for (const [path, contents] of Object.entries(files)) {
    entries[path] = strToU8(contents);
  }

  return new Blob([zipSync(entries) as unknown as BlobPart]);
}

function docxBlob(bodyXml: string): Blob {
  return zipToBlob({
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": `<?xml version="1.0"?><w:document><w:body>${bodyXml}</w:body></w:document>`,
  });
}

describe("applyLengthLimit", () => {
  it("laat tekst binnen de grens ongemoeid", () => {
    expect(applyLengthLimit("kort")).toBe("kort");
  });

  it("kapt af met een zichtbare mededeling", () => {
    const limited = applyLengthLimit("a".repeat(MAX_PARSED_TEXT_LENGTH + 5_000));

    expect(limited.length).toBeLessThanOrEqual(MAX_PARSED_TEXT_LENGTH);
    expect(limited).toContain("Afgekapt");
  });
});

describe("parseDocumentFile", () => {
  it("leest Markdown zoals het er staat", async () => {
    const blob = new Blob(["# Kop\n\nInhoud."]);

    await expect(parseDocumentFile(blob, "markdown")).resolves.toEqual({
      text: "# Kop\n\nInhoud.",
      metadata: {},
    });
  });

  it("geeft null bij een leeg Markdown-bestand", async () => {
    await expect(parseDocumentFile(new Blob(["   \n"]), "markdown")).resolves.toBeNull();
  });

  it("leest een afbeelding bewust niet", async () => {
    await expect(parseDocumentFile(new Blob(["binair"]), "image")).resolves.toBeNull();
  });

  it("haalt tekst uit een DOCX", async () => {
    const blob = docxBlob(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Beslissingen</w:t></w:r></w:p>' +
        "<w:p><w:r><w:t>Agents werken via GitHub.</w:t></w:r></w:p>",
    );

    await expect(parseDocumentFile(blob, "docx")).resolves.toEqual({
      text: "# Beslissingen\nAgents werken via GitHub.",
      metadata: {},
    });
  });

  it("geeft null bij een DOCX zonder leesbare tekst", async () => {
    await expect(parseDocumentFile(docxBlob("<w:p/>"), "docx")).resolves.toBeNull();
  });

  it("haalt de werkbladen uit een XLSX en noemt hun namen", async () => {
    const blob = zipToBlob({
      "xl/workbook.xml":
        "<workbook><sheets>" +
        '<sheet name="Kosten" sheetId="1" r:id="rId1"/>' +
        "</sheets></workbook>",
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Target="worksheets/sheet1.xml" Id="rId1"/></Relationships>',
      "xl/sharedStrings.xml": "<sst><si><t>Missie</t></si><si><t>Stap 25</t></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>0.27</v></c></row>' +
        "</sheetData></worksheet>",
    });

    await expect(parseDocumentFile(blob, "xlsx")).resolves.toEqual({
      text: "## Werkblad: Kosten\n\nMissie\nStap 25\t0.27",
      metadata: { sheetNames: ["Kosten"] },
    });
  });

  it("geeft null wanneer de ZIP het verwachte onderdeel niet bevat", async () => {
    // Zo eindigt een beschadigd of verkeerd benoemd bestand: niet met een
    // half gelezen document, maar met "niet gelezen".
    const blob = zipToBlob({ "iets/anders.xml": "<leeg/>" });

    await expect(parseDocumentFile(blob, "docx")).resolves.toBeNull();
  });
});
