import { describe, expect, it } from "vitest";

import { extractDocxText, headingLevelFromStyle } from "./docx-text";

/**
 * De XML in deze tests is niet verzonnen: het zijn ingekorte fragmenten uit
 * documenten die werkelijk door Word, python-docx en pandoc zijn geschreven.
 * Dat onderscheid doet ertoe — een parser die tegen zelfbedachte XML slaagt,
 * zegt alleen dat hij bij zijn eigen aannames past.
 */

function paragraph(text: string, styleId?: string): string {
  const properties = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : "";

  return `<w:p>${properties}<w:r><w:t>${text}</w:t></w:r></w:p>`;
}

describe("headingLevelFromStyle", () => {
  it("herkent de Engelse en de Nederlandse stijlnaam", () => {
    expect(headingLevelFromStyle("Heading1")).toBe(1);
    expect(headingLevelFromStyle("Kop3")).toBe(3);
    expect(headingLevelFromStyle("heading 2")).toBe(2);
  });

  it("behandelt titel en ondertitel als kop 1 en 2", () => {
    expect(headingLevelFromStyle("Title")).toBe(1);
    expect(headingLevelFromStyle("Subtitle")).toBe(2);
  });

  it("geeft nul voor een gewone alineastijl", () => {
    expect(headingLevelFromStyle("BodyText")).toBe(0);
    expect(headingLevelFromStyle(null)).toBe(0);
  });
});

describe("extractDocxText", () => {
  it("leest alinea's als losse regels", () => {
    const xml = `<w:body>${paragraph("Eerste")}${paragraph("Tweede")}</w:body>`;

    expect(extractDocxText(xml)).toBe("Eerste\nTweede");
  });

  it("maakt van koppen Markdown-koppen", () => {
    const xml = `<w:body>${paragraph("De Dost Matrix", "Heading1")}${paragraph(
      "Inleiding",
    )}${paragraph("Beslissingen", "Heading2")}</w:body>`;

    expect(extractDocxText(xml)).toBe(
      "# De Dost Matrix\nInleiding\n\n## Beslissingen",
    );
  });

  it("houdt een tabel als tabel bij elkaar", () => {
    const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
    const xml =
      `<w:tbl><w:tr>${cell("Naam")}${cell("Aantal")}</w:tr>` +
      `<w:tr>${cell("Missie 63")}${cell("2")}</w:tr></w:tbl>`;

    expect(extractDocxText(xml)).toBe("Naam\tAantal\nMissie 63\t2");
  });

  it("verwerkt harde regeleindes en tabs binnen één alinea", () => {
    const xml =
      "<w:p><w:r><w:t>Regel een</w:t><w:br/><w:t>Regel twee</w:t>" +
      "<w:tab/><w:t>na een tab</w:t></w:r></w:p>";

    expect(extractDocxText(xml)).toBe("Regel een\nRegel twee\tna een tab");
  });

  it("ontcijfert entiteiten en bewaart bewust behouden spaties", () => {
    const xml =
      '<w:p><w:r><w:t xml:space="preserve">Onderzoek &amp; </w:t>' +
      "<w:t>ontwerp</w:t></w:r></w:p>";

    expect(extractDocxText(xml)).toBe("Onderzoek & ontwerp");
  });

  it("neemt verwijderde tekst uit bijgehouden wijzigingen niet mee", () => {
    const xml =
      "<w:p><w:r><w:t>Wat blijft</w:t></w:r>" +
      "<w:del><w:r><w:delText> en wat weg moest</w:delText></w:r></w:del></w:p>";

    expect(extractDocxText(xml)).toBe("Wat blijft");
  });

  it("levert een lege tekenreeks bij een document zonder tekst", () => {
    expect(extractDocxText("<w:body><w:p/></w:body>")).toBe("");
  });
});
