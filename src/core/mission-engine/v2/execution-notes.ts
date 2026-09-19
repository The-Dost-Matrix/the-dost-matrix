/**
 * Haalt aantekeningen van de Builder over zijn eigen werkomgeving uit een
 * opgeleverd bestand.
 *
 * WAAR DIT VANDAAN KOMT
 *
 * PR #64 (18 september 2026) leverde een keurig testbestand op, met bovenin:
 *
 *     /**
 *      * Uitvoeringsblokkade: de beschikbare tools kunnen alleen bestanden
 *      * lezen. Niet uitgevoerd: npm test ..., npm run typecheck ... Er is
 *      * geen PR geopend.
 *      *\/
 *
 * Dat is de Builder die zijn werksituatie van dát moment vastlegt in code die
 * blijft staan. Het was al onwaar voordat iemand het las: de CI heeft die
 * typecheck en die tests gedraaid, en er wás een pull request. Zowel QA als de
 * mergebeoordelaar signaleerde het; geen van beiden blokkeerde erop, terecht,
 * want het is rommel en geen defect.
 *
 * Dezelfde familie als de misser van 15 september waarbij proza in een
 * `.ts`-bestand belandde — daar vangt `looksLikeSourceCode` het af.
 *
 * WAAROM DIT NIET WEIGERT MAAR OPRUIMT
 *
 * `looksLikeSourceCode` gooit, en dat hoort ook: een bestand vol proza is
 * onbruikbaar. Hier is de code juist goed en is alleen een opmerking overbodig.
 * Een missie laten falen op een opmerking zou de hele lus opnieuw laten draaien
 * voor iets wat in één regel weg te halen is — precies het soort blokkade dat
 * dit project bewust niet wil (zie "laat de oude weg altijd open" in
 * docs/roadmap.md).
 *
 * De eerste verdediging is dan ook de systeeminstructie voor de Builder, die
 * dit soort aantekeningen verbiedt. Dit bestand is het vangnet daaronder, en
 * een vangnet dat te gretig is richt meer schade aan dan het voorkomt: er
 * wordt daarom alleen een heel commentaarblok verwijderd, nooit een deel
 * ervan, en alleen wanneer er minstens twee onafhankelijke aanwijzingen in
 * staan. Eén aanwijzing is te weinig — "deze test wordt niet uitgevoerd in CI"
 * is een volstrekt normale opmerking, en die hoort te blijven staan. Liever
 * een enkele opmerking laten staan dan er één weghalen die ertoe deed.
 */

/**
 * Elk van deze wijst op een Builder die over zijn eigen uitvoering praat in
 * plaats van over de code. Ze zijn bewust in de eerste persoon of over het
 * gereedschap zelf geformuleerd; een opmerking over het gedrag van de code
 * raakt er niet aan.
 */
export const EXECUTION_NOTE_MARKERS: readonly RegExp[] = [
  /uitvoeringsblokkade/i,
  /niet uitgevoerd\s*:/i,
  /kon(?:den)? (?:ik |we )?niet (?:worden )?uitgevoerd/i,
  /de beschikbare (?:tools|gereedschappen)/i,
  /er is geen (?:pull request|pr) geopend/i,
  /geen (?:pull request|pr) (?:kunnen )?openen/i,
  /(?:ik|we) (?:kan|kon|kunnen|konden) .{0,60}niet (?:draaien|uitvoeren|controleren)/i,
];

/**
 * Commentaarblokken die aan het begin van een regel beginnen. Die beperking is
 * er met opzet: een `/*` midden in een regel staat vrijwel altijd in een
 * tekenreeks, en daar hoort dit nooit aan te komen.
 */
const COMMENT_BLOCK_PATTERN = /^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\r?\n?|^(?:[ \t]*\/\/.*(?:\r?\n|$))+/gm;

export function countExecutionNoteMarkers(text: string): number {
  return EXECUTION_NOTE_MARKERS.filter((marker) => marker.test(text)).length;
}

/**
 * Hoeveel aanwijzingen er minstens in één commentaarblok moeten staan voordat
 * het wordt weggehaald. Zie de toelichting bovenaan waarom dit er twee zijn en
 * niet één.
 */
export const MIN_MARKERS_TO_STRIP = 2;

export interface StripResult {
  content: string;
  /** De letterlijk verwijderde blokken, voor het logboek. Leeg als er niets weg hoefde. */
  removed: string[];
}

export function stripExecutionNotes(content: string): StripResult {
  const removed: string[] = [];

  const cleaned = content.replace(COMMENT_BLOCK_PATTERN, (block) => {
    if (countExecutionNoteMarkers(block) < MIN_MARKERS_TO_STRIP) return block;

    removed.push(block.trim());
    return "";
  });

  if (removed.length === 0) return { content, removed };

  // Waar een blok wegvalt blijft een dubbele lege regel achter. Die wordt
  // teruggebracht tot één, en alleen dáár — de rest van het bestand blijft
  // letterlijk zoals de Builder hem schreef.
  return { content: cleaned.replace(/\n{3,}/g, "\n\n"), removed };
}
