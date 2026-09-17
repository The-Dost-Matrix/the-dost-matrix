import { decodeXmlEntities, readAttribute, tidyExtractedText } from "./xml-text";

/**
 * Tekstextractie uit een XLSX.
 *
 * Een werkblad wordt als tab-gescheiden tekst weergegeven, met de bladnaam als
 * kop erboven. Dat is geen willekeurige vorm: een taalmodel leest een tabel
 * met uitgelijnde kolommen aanzienlijk betrouwbaarder dan een opsomming van
 * losse celwaarden, en de kolompositie draagt in een spreadsheet betekenis.
 * Vandaar ook dat lege cellen hun plaats houden — kolom C blijft kolom C, ook
 * als B leeg is.
 *
 * BEKENDE BEPERKING — DATUMS
 *
 * Excel bewaart een datum als getal (het aantal dagen sinds 1900) en laat de
 * weergave over aan een celopmaak die in weer een ander bestand in de ZIP
 * staat. Dit leest de opgeslagen waarde, dus een datum komt eruit als getal.
 * Dat is bewust niet opgelost: de opmaakketen navolgen is een parser op zich,
 * en het zou een eigen soort onwaarheid opleveren als hij er net naast zit.
 * Een getal dat zichtbaar een getal is, is eerlijker dan een datum die stiekem
 * een dag verschoven is.
 */

export interface XlsxWorksheet {
  name: string;
  rows: string[][];
}

/**
 * De gedeelde tekstentabel. Excel zet iedere unieke tekst één keer in
 * `xl/sharedStrings.xml` en verwijst er vanuit de cellen met een nummer naar.
 * Zonder deze tabel bestaat een werkblad uit niets dan indexen.
 */
export function parseSharedStrings(sharedStringsXml: string): string[] {
  const strings: string[] = [];
  const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;

  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(sharedStringsXml)) !== null) {
    strings.push(match[1] === undefined ? "" : readRichText(match[1]));
  }

  return strings;
}

/**
 * Eén tekstwaarde kan uit meerdere stukken bestaan wanneer er binnen de cel
 * opmaak wisselt ("rich text"): elk stuk is een eigen `<t>`. Aan elkaar
 * plakken levert de oorspronkelijke zin op.
 */
function readRichText(fragment: string): string {
  let text = "";
  const pattern = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;

  let match: RegExpExecArray | null;

  while ((match = pattern.exec(fragment)) !== null) {
    text += decodeXmlEntities(match[1]);
  }

  return text;
}

/**
 * Zet de kolomletters uit een celverwijzing ("BC12") om naar een positie,
 * nul-gebaseerd. Dit is wat lege cellen hun plaats laat houden.
 */
export function columnIndexFromReference(reference: string): number {
  const letters = /^([A-Z]+)/.exec(reference.toUpperCase());

  if (!letters) return 0;

  let index = 0;

  for (const letter of letters[1]) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }

  return index - 1;
}

const CELL_PATTERN = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const ROW_PATTERN = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;

function readCellValue(
  attributes: string,
  body: string,
  sharedStrings: string[],
): string {
  const type = readAttribute(attributes, "t") ?? "n";

  if (type === "inlineStr") {
    return readRichText(body);
  }

  const valueMatch = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body);

  if (!valueMatch) return "";

  const raw = decodeXmlEntities(valueMatch[1]);

  if (type === "s") {
    const index = Number.parseInt(raw, 10);

    return Number.isFinite(index) ? sharedStrings[index] ?? "" : "";
  }

  if (type === "b") {
    return raw === "1" ? "WAAR" : "ONWAAR";
  }

  // "e" is een foutwaarde (#DIV/0! en zo), "str" het resultaat van een
  // formule, "n" een getal. Alle drie staan al leesbaar in het bestand.
  return raw;
}

export function parseWorksheet(
  worksheetXml: string,
  sharedStrings: string[],
): string[][] {
  const rows: string[][] = [];

  ROW_PATTERN.lastIndex = 0;

  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = ROW_PATTERN.exec(worksheetXml)) !== null) {
    const rowBody = rowMatch[1];

    if (rowBody === undefined) {
      rows.push([]);
      continue;
    }

    const cells: string[] = [];

    CELL_PATTERN.lastIndex = 0;

    let cellMatch: RegExpExecArray | null;
    let nextIndex = 0;

    while ((cellMatch = CELL_PATTERN.exec(rowBody)) !== null) {
      const attributes = cellMatch[1] ?? "";
      const reference = readAttribute(attributes, "r");
      const index = reference ? columnIndexFromReference(reference) : nextIndex;

      while (cells.length < index) {
        cells.push("");
      }

      const value = readCellValue(attributes, cellMatch[2] ?? "", sharedStrings);

      if (cells.length === index) {
        cells.push(value);
      } else {
        cells[index] = value;
      }

      nextIndex = index + 1;
    }

    rows.push(cells);
  }

  return rows;
}

/**
 * De bladnamen staan in `xl/workbook.xml`, maar welk bestand in de ZIP bij
 * welke naam hoort staat in `xl/_rels/workbook.xml.rels`. Die omweg is nodig
 * omdat de nummering in "sheet1.xml" niets zegt over de volgorde of de naam —
 * een hernoemd of verplaatst blad houdt zijn oude bestandsnaam.
 */
export function resolveWorksheetPaths(
  workbookXml: string,
  relationshipsXml: string,
): { name: string; path: string }[] {
  const targets = new Map<string, string>();
  const relationshipPattern = /<Relationship\b([^>]*)\/?>/g;

  let relationshipMatch: RegExpExecArray | null;

  while ((relationshipMatch = relationshipPattern.exec(relationshipsXml)) !== null) {
    const attributes = relationshipMatch[1];
    const id = readAttribute(attributes, "Id");
    const target = readAttribute(attributes, "Target");

    if (id && target) {
      targets.set(id, target.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
    }
  }

  const sheets: { name: string; path: string }[] = [];
  const sheetPattern = /<sheet\b([^>]*)\/?>/g;

  let sheetMatch: RegExpExecArray | null;

  while ((sheetMatch = sheetPattern.exec(workbookXml)) !== null) {
    const attributes = sheetMatch[1];
    const name = readAttribute(attributes, "name");
    const relationshipId = readAttribute(attributes, "r:id");

    if (!name) continue;

    const target = relationshipId ? targets.get(relationshipId) : undefined;

    sheets.push({
      name,
      path: `xl/${target ?? `worksheets/sheet${sheets.length + 1}.xml`}`,
    });
  }

  return sheets;
}

/**
 * Zet de ontlede werkbladen om in de tekst die naar de kennisextractie gaat.
 * Lege bladen krijgen geen kop — een lijst met bladnamen zonder inhoud leest
 * als informatie terwijl het er geen is.
 */
export function formatWorksheets(worksheets: XlsxWorksheet[]): string {
  const blocks: string[] = [];

  for (const worksheet of worksheets) {
    const lines = worksheet.rows
      .map((cells) => cells.join("\t").replace(/\t+$/, ""))
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) continue;

    blocks.push(`## Werkblad: ${worksheet.name}\n\n${lines.join("\n")}`);
  }

  return tidyExtractedText(blocks.join("\n\n"));
}
