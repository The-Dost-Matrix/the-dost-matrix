import { decodeXmlEntities, readAttribute, tidyExtractedText } from "./xml-text";

/**
 * Tekstextractie uit het hart van een DOCX: `word/document.xml`.
 *
 * WAT WEL EN WAT NIET WORDT GELEZEN
 *
 * Wel: gewone alineatekst, koppen (die worden Markdown-koppen), tekst in
 * tabellen (cellen gescheiden door een tab, rijen door een regeleinde), harde
 * regeleindes en tabs.
 *
 * Niet: kop- en voetteksten, voetnoten en opmerkingen — die staan in aparte
 * bestanden in de ZIP. En niet: tekst die als verwijderd is gemarkeerd in
 * bijgehouden wijzigingen (`w:delText`). Dat laatste is een bewuste keuze;
 * verwijderde tekst is door de schrijver weggehaald, en die alsnog als kennis
 * opnemen zou het document tegenspreken.
 *
 * WAAROM KOPPEN ERTOE DOEN
 *
 * De gewonnen tekst gaat naar de kennisextractie, en die vult per kennisitem
 * een `section`-veld. Zonder koppen is dat veld gokwerk. Een Markdown-bestand
 * — de enige bron die tot nu toe werd gelezen — houdt zijn koppen wél, dus
 * zonder dit zou een DOCX systematisch slechtere kennis opleveren dan
 * dezelfde tekst in Markdown.
 */

/**
 * Eén doorloop over alles wat een tekstpositie bepaalt, in documentvolgorde.
 *
 * De tekst-tak slaat alleen aan op een echte `w:t`-tag (meteen `>` of eerst
 * witruimte) en dus nooit op `w:tab`, `w:tbl` of `w:delText`.
 *
 * `</w:p></w:tc>` staat bewust vóór de losse `</w:p>`: de laatste alinea in
 * een tabelcel moet een tab opleveren en geen regeleinde, anders valt elke
 * cel van een tabel op zijn eigen regel en is de tabel als tabel weg.
 */
const DOCX_TOKEN =
  /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:pStyle\b([^>]*)\/?>|<w:p(?:\s[^>]*)?>|<\/w:p>\s*<\/w:tc>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;

/**
 * Word bewaart de stijl onder een taalonafhankelijke identificatie
 * ("Heading2"), maar niet elk sjabloon houdt zich daaraan — door Nederlandse
 * versies gemaakte sjablonen gebruiken soms "Kop2". Allebei herkennen kost
 * één alternatief en voorkomt dat koppen in de helft van de documenten
 * ongemerkt gewone alinea's worden.
 */
export function headingLevelFromStyle(styleId: string | null): number {
  if (!styleId) return 0;

  const numbered = /^(?:heading|kop)\s*([1-9])$/i.exec(styleId.trim());

  if (numbered) return Math.min(6, Number.parseInt(numbered[1], 10));

  if (/^title$/i.test(styleId.trim())) return 1;
  if (/^subtitle$/i.test(styleId.trim())) return 2;

  return 0;
}

export function extractDocxText(documentXml: string): string {
  let result = "";
  let paragraphStart = 0;
  let paragraphHeadingLevel = 0;

  DOCX_TOKEN.lastIndex = 0;

  let match: RegExpExecArray | null;

  while ((match = DOCX_TOKEN.exec(documentXml)) !== null) {
    const token = match[0];

    if (match[1] !== undefined) {
      result += decodeXmlEntities(match[1]);
      continue;
    }

    if (match[2] !== undefined) {
      paragraphHeadingLevel = headingLevelFromStyle(readAttribute(match[2], "w:val"));
      continue;
    }

    if (token.startsWith("<w:tab")) {
      result += "\t";
      continue;
    }

    if (token.startsWith("<w:br") || token.startsWith("<w:cr")) {
      result += "\n";
      continue;
    }

    if (token.startsWith("<w:p")) {
      paragraphStart = result.length;
      paragraphHeadingLevel = 0;
      continue;
    }

    // Vanaf hier sluit de token een alinea, een cel of een rij af. Eerst de
    // kop toepassen, want die geldt voor precies de tekst die er sinds het
    // begin van deze alinea bij is gekomen.
    if (paragraphHeadingLevel > 0 && result.length > paragraphStart) {
      result =
        result.slice(0, paragraphStart) +
        `\n${"#".repeat(paragraphHeadingLevel)} ` +
        result.slice(paragraphStart);
    }

    paragraphHeadingLevel = 0;

    if (token === "</w:tc>" || token.endsWith("</w:tc>")) {
      result += "\t";
      continue;
    }

    result += "\n";
  }

  // Een cel sluit af met een tab en de rij daarna met een regeleinde; dat
  // levert een overtollige tab aan het eind van elke tabelrij op.
  return tidyExtractedText(result.replace(/\t+\n/g, "\n"));
}
