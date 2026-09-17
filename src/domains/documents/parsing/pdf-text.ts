import { tidyExtractedText } from "./xml-text";

/**
 * Tekstextractie uit een PDF, in de browser, met pdf.js.
 *
 * WAAROM DE WERKER UIT `public/` KOMT
 *
 * pdf.js doet het zware werk in een aparte browserwerker, en die moet als
 * bestand bereikbaar zijn. De gangbare manier om daarnaar te verwijzen is
 * `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`, waarbij
 * de bundelaar het pad tijdens de bouw oplost. Dat is hier bewust niet
 * gedaan: pdf.js heeft die bestandsnaam tussen grote versies al eens
 * verplaatst, en als de bundelaar het pad niet vindt faalt niet de upload
 * maar de hele bouw op Vercel — een fout die pas zichtbaar wordt nadat er al
 * gepusht is.
 *
 * In plaats daarvan kopieert `scripts/copy-pdf-worker.mjs` de werker na elke
 * `npm install` naar `public/`, en verwijst de code ernaar met een gewone
 * URL. Die kopie komt altijd uit de versie die werkelijk geïnstalleerd is, en
 * kan dus niet uit de pas lopen met de bibliotheek — pdf.js weigert namelijk
 * te draaien als werker en hoofdbibliotheek van verschillende versies zijn.
 *
 * Lukt het toch niet, dan is de uitkomst `null` en valt het uploadpad terug op
 * alleen vastleggen. Nooit half.
 */

export const PDF_WORKER_URL = "/pdf.worker.min.mjs";

export interface ExtractedPdf {
  text: string;
  metadata: { pageCount: number };
}

/**
 * Eén regel tekst uit pdf.js bestaat uit losse stukjes met elk een eigen
 * positie; een PDF kent geen alinea's, alleen letters op coördinaten. pdf.js
 * geeft per stukje aan of er een regelovergang op volgt (`hasEOL`). Dat is de
 * enige betrouwbare aanwijzing die er is, en daarmee wordt hier de tekst weer
 * aan elkaar gezet.
 *
 * Apart van de aanroep van pdf.js gehouden zodat dit deel — waar de fouten in
 * zitten — gewoon met unit tests te dekken is.
 */
export function joinTextItems(items: readonly unknown[]): string {
  let line = "";
  const lines: string[] = [];

  for (const item of items) {
    // pdf.js levert in dezelfde lijst ook opmaakmarkeringen zonder `str`.
    // Vandaar `unknown` en hier narrowen, in plaats van het binnenkomende
    // type om te duwen: dat laatste breekt zodra pdf.js zijn typen wijzigt,
    // en dat doet die bibliotheek bij elke grote versie.
    const fragment = item as { str?: unknown; hasEOL?: unknown } | null;

    if (typeof fragment?.str === "string") {
      line += fragment.str;
    }

    if (fragment?.hasEOL === true) {
      lines.push(line.trimEnd());
      line = "";
    }
  }

  if (line.trim()) lines.push(line.trimEnd());

  return lines.join("\n");
}

/**
 * Een PDF die alleen ingescande bladzijden bevat levert geen tekst op — er
 * staan immers plaatjes in, geen letters. Dat is geen fout maar een eerlijke
 * lege uitkomst, en die hoort als "niet gelezen" te eindigen en niet als een
 * document zonder inhoud.
 */
export async function extractPdfText(buffer: ArrayBuffer): Promise<ExtractedPdf | null> {
  const pdfjs = await import("pdfjs-dist");

  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  }

  // Alleen `data` meegeven. pdf.js 6 heeft de optie `isEvalSupported` laten
  // vervallen; hem meegeven zou hier niet stilletjes genegeerd worden maar de
  // typecontrole laten falen. Het uitvoeren van ingebed script in een PDF is
  // in deze versie sowieso niet meer aan de orde.
  //
  // De laadtaak wordt bewust vastgehouden: in pdf.js 6 zit `destroy()` op de
  // laadtaak en niet meer op het document zelf. Zonder die aanroep blijft de
  // browserwerker met het hele bestand in het geheugen staan, en bij het
  // achter elkaar inlezen van een reeks documenten is dat het verschil tussen
  // werken en een vastlopend tabblad.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
  });

  // Bewust niet `document` genoemd: dit draait in de browser, waar die naam
  // al bezet is door het HTML-document.
  const pdf = await loadingTask.promise;

  try {
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = joinTextItems(content.items);

      if (pageText.trim()) pages.push(pageText);

      page.cleanup();
    }

    const text = tidyExtractedText(pages.join("\n\n"));

    return text ? { text, metadata: { pageCount: pdf.numPages } } : null;
  } finally {
    await loadingTask.destroy();
  }
}
