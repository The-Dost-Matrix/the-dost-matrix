/**
 * Stap 18 (deel 2) — gerichte bewerkingen in plaats van hele bestanden
 * herschrijven.
 *
 * WAAROM DIT BESTAAT
 *
 * De Builder schrijft een bestand tot nu toe door de VOLLEDIGE nieuwe inhoud
 * terug te geven, ook wanneer er maar drie regels veranderen. Dat heeft twee
 * kosten die allebei meegroeien met de bestandsgrootte.
 *
 * De ene is geld en tijd: een bestand van 38.000 tekens moet volledig opnieuw
 * uitgetypt worden om er één regel in te wijzigen.
 *
 * De andere is erger, want stil. Bij het overtypen van een lang bestand kan er
 * onderweg iets verdwijnen zonder dat iemand het merkt — precies wat er met
 * globals.css gebeurde (zie de toelichting bij MAX_FILE_CONTENT_LENGTH in
 * builder-runtime.ts). Die ene keer ving QA het af, maar dat is geluk, geen
 * garantie: het model geeft immers keurig "de volledige inhoud" terug en er is
 * geen enkel signaal dat er iets ontbreekt.
 *
 * Met een bewerkingsblok verandert de aard van de fout. De Builder zegt niet
 * meer "dit is het hele bestand" maar "vervang precies dit stuk door dat
 * stuk". Wat hij niet noemt, blijft per definitie ongemoeid. En klopt zijn
 * zoekfragment niet exact, dan mislukt het hoorbaar in plaats van dat er
 * stilletjes iets wegvalt.
 *
 * WAAROM DIT FORMAAT EN GEEN UNIFIED DIFF
 *
 * Een echte diff (`@@ -12,7 +12,9 @@`) vraagt van het model dat het regels
 * telt. Dat gaat vaak mis, en een diff met verkeerde regelnummers is precies
 * het soort fout dat je met een ruime toepassing alsnog "ergens" toepast.
 * Zoeken-en-vervangen op letterlijke tekst vraagt geen telwerk en is
 * deterministisch toe te passen: het fragment komt één keer voor, of het
 * mislukt.
 *
 * DRIE REGELS DIE NIET ONDERHANDELBAAR ZIJN
 *
 * 1. Een zoekfragment moet EXACT ÉÉN keer voorkomen. Nul keer betekent dat het
 *    model iets citeert wat er niet staat. Meer dan één keer betekent dat niet
 *    vaststaat welke plek bedoeld is — en "dan maar de eerste" is raden.
 * 2. Alles of niets. Mislukt één blok, dan wordt er geen enkel blok toegepast.
 *    Een half bewerkt bestand is erger dan een onbewerkt bestand, want het
 *    ziet er compleet uit.
 * 3. Tekst buiten de blokken wordt genegeerd. Modellen schrijven graag een
 *    inleidende zin. In de hele-bestand-modus is dat rampzalig (die zin belandt
 *    dan ín het bestand); hier kan het geen kwaad, dus is streng zijn op dat
 *    punt alleen maar een extra faalreden zonder winst.
 */

export type PatchEditErrorCode =
  | "NO_EDIT_BLOCKS"
  | "EMPTY_SEARCH"
  | "SEARCH_NOT_FOUND"
  | "SEARCH_NOT_UNIQUE";

export class PatchEditError extends Error {
  readonly code: PatchEditErrorCode;

  constructor(code: PatchEditErrorCode, message: string) {
    super(message);
    this.name = "PatchEditError";
    this.code = code;
  }
}

const SEARCH_MARKER = "<<<<<<< ZOEK";
const DIVIDER_MARKER = "=======";
const REPLACE_MARKER = ">>>>>>> VERVANG";

/**
 * De beschrijving van het formaat zoals die letterlijk in de prompt komt.
 *
 * Bewust hier en niet in builder-runtime.ts: de parser hieronder en de uitleg
 * aan het model horen één bron te hebben. Verandert het formaat, dan verandert
 * de uitleg mee — in plaats van dat er twee beschrijvingen zijn die stilletjes
 * uiteen kunnen lopen.
 */
export const EDIT_BLOCK_FORMAT = [
  `${SEARCH_MARKER}`,
  "(de exacte bestaande tekst, letterlijk overgenomen uit de huidige inhoud hierboven)",
  `${DIVIDER_MARKER}`,
  "(de tekst die daarvoor in de plaats komt; laat dit leeg om het te verwijderen)",
  `${REPLACE_MARKER}`,
].join("\n");

export interface EditBlock {
  search: string;
  replace: string;
}

/** Of dit antwoord überhaupt op bewerkingsblokken lijkt. */
export function containsEditBlocks(text: string): boolean {
  return text.includes(SEARCH_MARKER);
}

/**
 * Leest de bewerkingsblokken uit een antwoord.
 *
 * Regelgebaseerd en niet met één grote reguliere expressie: zo kan er per
 * blok precies gezegd worden wat er mis is, en kan tekst buiten de blokken
 * zonder omhaal genegeerd worden.
 */
export function parseEditBlocks(text: string): EditBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: EditBlock[] = [];

  let state: "outside" | "search" | "replace" = "outside";
  let search: string[] = [];
  let replace: string[] = [];

  for (const line of lines) {
    const marker = line.trimEnd();

    if (state === "outside") {
      if (marker === SEARCH_MARKER) {
        state = "search";
        search = [];
        replace = [];
      }
      continue;
    }

    if (state === "search") {
      if (marker === DIVIDER_MARKER) {
        state = "replace";
        continue;
      }

      search.push(line);
      continue;
    }

    if (marker === REPLACE_MARKER) {
      blocks.push({ search: search.join("\n"), replace: replace.join("\n") });
      state = "outside";
      continue;
    }

    replace.push(line);
  }

  if (blocks.length === 0) {
    throw new PatchEditError(
      "NO_EDIT_BLOCKS",
      `Het antwoord bevat geen enkel bewerkingsblok. Verwacht werd minstens één blok in dit formaat:\n${EDIT_BLOCK_FORMAT}`,
    );
  }

  return blocks;
}

function describeFragment(fragment: string): string {
  const firstLine = fragment.split("\n").find((line) => line.trim() !== "") ?? "";
  const shortened = firstLine.trim().slice(0, 120);

  return shortened || "(alleen witruimte)";
}

/**
 * Past de blokken één voor één toe op de inhoud.
 *
 * Elk blok werkt op het resultaat van het vorige, zodat twee bewerkingen in
 * hetzelfde bestand elkaar niet in de weg zitten. Mislukt er één, dan wordt er
 * niets teruggegeven en is er dus ook niets half toegepast.
 */
export function applyEditBlocks(source: string, blocks: readonly EditBlock[]): string {
  let content = source;

  blocks.forEach((block, index) => {
    const position = index + 1;

    if (block.search === "") {
      throw new PatchEditError(
        "EMPTY_SEARCH",
        `Bewerking ${position} heeft een leeg zoekfragment. Zet tussen de ZOEK- en de scheidingsregel de exacte tekst die vervangen moet worden.`,
      );
    }

    const occurrences = content.split(block.search).length - 1;

    if (occurrences === 0) {
      throw new PatchEditError(
        "SEARCH_NOT_FOUND",
        `Het zoekfragment van bewerking ${position} komt niet voor in het bestand. Het begon met: "${describeFragment(block.search)}". Neem de tekst letterlijk over uit de huidige inhoud, inclusief inspringing en leestekens.`,
      );
    }

    if (occurrences > 1) {
      throw new PatchEditError(
        "SEARCH_NOT_UNIQUE",
        `Het zoekfragment van bewerking ${position} komt ${occurrences} keer voor in het bestand, dus staat niet vast welke plek bedoeld is. Het begon met: "${describeFragment(block.search)}". Maak het zoekfragment groter door er omliggende regels bij te nemen tot het uniek is.`,
      );
    }

    // Vervangen via een functie en niet via de tekst zelf: in een gewone
    // vervangtekst hebben `$&`, `$1` en `$'` een speciale betekenis voor
    // JavaScript. Code die toevallig zo'n reeks bevat zou dan stilzwijgend
    // veranderen in iets anders dan wat het model bedoelde. Met een functie
    // wordt de tekst letterlijk genomen.
    content = content.replace(block.search, () => block.replace);
  });

  return content;
}

/**
 * Leest en past in één keer toe. De aanroeper hoeft daardoor maar één
 * foutsoort af te vangen.
 */
export function applyEditResponse(source: string, response: string): string {
  return applyEditBlocks(source, parseEditBlocks(response));
}
