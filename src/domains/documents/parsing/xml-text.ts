/**
 * Kleine XML-hulpjes voor de documentparsers.
 *
 * WAAROM GEEN ECHTE XML-PARSER
 *
 * DOCX en XLSX zijn ZIP-bestanden met XML erin, en de browser heeft met
 * `DOMParser` een volwaardige XML-parser aan boord. Die wordt hier bewust niet
 * gebruikt: `DOMParser` bestaat alleen in de browser, en dan zijn de parsers
 * niet meer te testen zonder een browseromgeving in vitest te hangen (zie
 * vitest.config.ts — dat draait bewust op `node`, zonder jsdom).
 *
 * Tekst uit Office-XML halen is geen boomwandeling maar een lineaire lezing:
 * loop de tekstknopen langs in documentvolgorde en plak ze aan elkaar. Dat
 * kan met reguliere expressies, blijft pure functietekst in en tekst uit, en
 * is daarmee gewoon met unit tests te dekken.
 *
 * De bekende beperking daarvan: dit leest geen XML waarin een tekstknoop zelf
 * weer opmaak bevat die betekenis draagt. Voor tekstextractie maakt dat niet
 * uit — het gaat om de woorden, niet om het vet.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * Zet XML-entiteiten terug om naar gewone tekens. Zonder dit komt een titel
 * als "Onderzoek &amp; ontwerp" letterlijk met "&amp;" in de Second Brain
 * terecht.
 */
export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);

      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);

      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return NAMED_ENTITIES[entity] ?? match;
  });
}

/**
 * Haalt de waarde van één attribuut uit een geopende tag.
 */
export function readAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag);

  return match ? decodeXmlEntities(match[1]) : null;
}

/**
 * Ruimt het resultaat van een extractie op: losse spaties aan het eind van een
 * regel weg, nooit meer dan één lege regel achter elkaar, en geen witruimte
 * aan het begin of eind van het geheel.
 *
 * Dit is geen cosmetica. De opgehaalde tekst gaat als prompt naar de
 * kennisextractie, en een document dat voor de helft uit lege regels bestaat
 * kost daar tokens zonder iets toe te voegen.
 */
export function tidyExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
