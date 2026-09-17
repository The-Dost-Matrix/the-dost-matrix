import { strFromU8, unzipSync } from "fflate";

import type { DocumentSourceType } from "@/domains/documents/model/document";

import { extractDocxText } from "./docx-text";
import {
  formatWorksheets,
  parseSharedStrings,
  parseWorksheet,
  resolveWorksheetPaths,
  type XlsxWorksheet,
} from "./xlsx-text";

/**
 * Stap 25 — het lezen van een geüpload document, in de browser.
 *
 * WAAROM IN DE BROWSER EN NIET OP DE SERVER
 *
 * De oorspronkelijke volgorde uit de code-audit van 13 september 2026 was:
 * eerst de bytes naar de server, daar bewaren en hashen, en pas daarna lezen.
 * Die volgorde loopt op twee muren:
 *
 * 1. Vercel accepteert ongeveer 4,5 MB per aanvraag. Een PDF van 10 MB komt
 *    dus sowieso niet door de serverfunctie heen.
 * 2. De originele bytes bewaren vraagt Firebase Storage, en dat zit sinds eind
 *    2024 niet meer in het gratis Firebase-pakket.
 *
 * De inhoud lezen waar het bestand al is — in de browser — kent geen van
 * beide problemen: alleen de gewonnen tekst gaat over de lijn, en die is
 * klein. De prijs is dat het originele bestand niet wordt bewaard, dus een
 * document kan later niet opnieuw door een betere parser gehaald worden. Dat
 * is een aparte stap waard zodra Storage aanstaat, en is als zodanig in
 * docs/roadmap.md vastgelegd — niet stilzwijgend geschrapt.
 *
 * WAT DIT NIET DOET
 *
 * Er wordt niets geraden. Levert een parser geen bruikbare tekst op, dan is de
 * uitkomst `null` en valt het uploadpad terug op wat het altijd al deed: het
 * bestand uitsluitend vastleggen, met de eerlijke melding erbij dat de inhoud
 * niet is gelezen. Een half gelezen document dat zich voordoet als gelezen is
 * voor een systeem dat op zijn eigen kennis vertrouwt het duurste soort fout.
 */

export interface ParsedDocument {
  /** De gewonnen tekst. Nooit leeg: is er niets, dan is de uitkomst `null`. */
  text: string;

  metadata: {
    pageCount?: number;
    sheetNames?: string[];
  };
}

/**
 * Bovengrens op de tekst die naar de kennisextractie gaat. Die route weigert
 * zelf alles boven de 120.000 tekens (zie src/app/api/knowledge/import), en
 * een boek van 400 bladzijden zou daar zonder deze grens tegenaan lopen na een
 * upload die al minuten heeft geduurd. Afkappen mét mededeling is beter dan
 * een foutmelding achteraf.
 */
export const MAX_PARSED_TEXT_LENGTH = 118_000;

export const TRUNCATION_NOTICE =
  "\n\n[Afgekapt: dit document is langer dan wat in één keer verwerkt kan worden.]";

export function applyLengthLimit(text: string): string {
  if (text.length <= MAX_PARSED_TEXT_LENGTH) return text;

  return text.slice(0, MAX_PARSED_TEXT_LENGTH - TRUNCATION_NOTICE.length) + TRUNCATION_NOTICE;
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function readEntry(entries: Record<string, Uint8Array>, path: string): string | null {
  const entry = entries[path];

  return entry ? strFromU8(entry) : null;
}

function parseDocx(bytes: Uint8Array): ParsedDocument | null {
  const entries = unzip(bytes);
  const documentXml = readEntry(entries, "word/document.xml");

  if (!documentXml) return null;

  const text = extractDocxText(documentXml);

  return text ? { text, metadata: {} } : null;
}

function parseXlsx(bytes: Uint8Array): ParsedDocument | null {
  const entries = unzip(bytes);
  const workbookXml = readEntry(entries, "xl/workbook.xml");

  if (!workbookXml) return null;

  const sharedStrings = parseSharedStrings(
    readEntry(entries, "xl/sharedStrings.xml") ?? "",
  );

  const relationshipsXml = readEntry(entries, "xl/_rels/workbook.xml.rels") ?? "";
  const worksheets: XlsxWorksheet[] = [];

  for (const sheet of resolveWorksheetPaths(workbookXml, relationshipsXml)) {
    const worksheetXml = readEntry(entries, sheet.path);

    if (!worksheetXml) continue;

    worksheets.push({
      name: sheet.name,
      rows: parseWorksheet(worksheetXml, sharedStrings),
    });
  }

  const text = formatWorksheets(worksheets);

  if (!text) return null;

  return {
    text,
    metadata: { sheetNames: worksheets.map((worksheet) => worksheet.name) },
  };
}

/**
 * Leest een geüpload bestand uit. Gooit wanneer het lezen mislukt — de
 * aanroeper hoort dat te loggen en terug te vallen op alleen vastleggen.
 * Een beschadigde ZIP of een versleutelde PDF moet zichtbaar zijn in het
 * logboek, niet stilletjes verdwijnen in een leeg resultaat.
 */
export async function parseDocumentFile(
  file: Blob,
  sourceType: DocumentSourceType,
): Promise<ParsedDocument | null> {
  if (sourceType === "markdown") {
    const text = (await file.text()).trim();

    return text ? { text: applyLengthLimit(text), metadata: {} } : null;
  }

  // Afbeeldingen worden bewust niet gelezen: daar hoort tekstherkenning bij,
  // en die is er niet. De harde regel uit de roadmap geldt — de melding in de
  // UI zegt eerlijk dat de inhoud niet is gelezen.
  if (sourceType === "image") return null;

  if (sourceType === "pdf") {
    const { extractPdfText } = await import("./pdf-text");
    const parsed = await extractPdfText(await file.arrayBuffer());

    return parsed ? { ...parsed, text: applyLengthLimit(parsed.text) } : null;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = sourceType === "docx" ? parseDocx(bytes) : parseXlsx(bytes);

  return parsed ? { ...parsed, text: applyLengthLimit(parsed.text) } : null;
}
