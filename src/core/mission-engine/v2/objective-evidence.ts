/**
 * Bewijs uit de opdracht zelf — bestanden die de Director (of Elroy) met
 * naam en toenaam noemt.
 *
 * WAAROM DIT BESTAAT
 *
 * Gevonden op 14 september 2026, in een live missie die vier keer op rij
 * strandde. Het ruwe antwoord van het model uit de Vercel-logs liet zien dat
 * het niet faalde maar WEIGERDE, en waarom:
 *
 *   "De daadwerkelijke definitie van MissionAdvanceOutcome ontbreekt. Zonder
 *    repositorytoegang kan ik die niet raadplegen. Zonder die informatie zou
 *    een bewerkingsblok velden moeten veronderstellen, in strijd met je
 *    expliciete opdracht om niets te verzinnen."
 *
 * Het model deed precies wat het moest doen. De opdracht zei letterlijk
 * "importeer het type uit src/core/mission-engine/v2/autonomous-advance.ts",
 * en juist dat bestand kreeg het nooit te zien.
 *
 * DE GATEN DIE DIT DICHT
 *
 * De bewijslaag van stap 10 hangt volledig aan het TESTBESTAND: hij zoekt de
 * module onder test en gaat vandaar één laag diep (zie resolveTestContext in
 * builder-runtime.ts). Voor een gewoon bronbestand levert dat helemaal niets
 * op — dat krijgt alleen zijn eigen huidige inhoud te zien en verder niets.
 *
 * Een opdracht die een pad noemt, noemt dat pad niet voor de sier. Dat is de
 * meest expliciete aanwijzing die er bestaat over wat de Builder nodig heeft,
 * en hij was de enige die we nog niet gebruikten.
 *
 * WAAROM DIT GEEN VERVANGING IS VAN DEEL 4
 *
 * Dit dekt het geval waarin iemand vooraf wéét welk bestand nodig is en dat
 * opschrijft. Het dekt niet het geval waarin de Builder tijdens het werk pas
 * ontdekt dat hij nog iets moet inzien — daarvoor blijft hij afhankelijk van
 * wat wij vooraf bedenken. Dat is wat leestools (deel 4) oplossen. Dit is de
 * goedkope helft, zonder function calling.
 *
 * BEGRENSD EN CONSERVATIEF
 *
 * Alleen paden die daadwerkelijk in de bestandenlijst van de branch staan
 * tellen mee. Een pad dat het model of de Director verzint, valt daarmee
 * vanzelf af — er wordt nooit iets opgehaald op goed vertrouwen. En er zit
 * een harde bovengrens op het aantal bestanden, zodat een opdracht met een
 * lange opsomming de prompt niet kan laten ontploffen.
 */

/**
 * Hoeveel door de opdracht genoemde bestanden er maximaal meegaan.
 *
 * Vier. Een opdracht die er meer nodig heeft, is een opdracht die opgesplitst
 * hoort te worden — en dat is een gesprek met de Director, geen reden om de
 * prompt te laten groeien.
 */
export const MAX_OBJECTIVE_EVIDENCE_FILES = 4;

/**
 * Hoeveel tekens er per genoemd bestand maximaal meegaan.
 *
 * WAAROM DIT OP 20 SEPTEMBER 2026 VAN 6.000 NAAR 40.000 GING
 *
 * Een live missie strandde erop, en wel op de manier die dit bestand nu juist
 * had moeten voorkomen. De opdracht noemde
 * `src/core/mission-engine/v2/mission-duration.test.ts` met naam, dus het
 * bestand werd keurig gevonden en meegestuurd — afgekapt op 6.000 van de
 * 11.352 tekens, zonder dat erbij stond dat er iets ontbrak. De Builder zag
 * een testbestand dat midden in een test ophield, concludeerde dat hij de
 * bestaande testopzet niet kon controleren, en weigerde te schrijven.
 *
 * Dat is precies het juiste gedrag. De fout zat hier.
 *
 * 40.000 tekens is ruim boven elk bestand in dit project op één na, en met
 * hoogstens vier genoemde bestanden is de bovengrens 160.000 tekens —
 * ongeveer 45.000 tokens in het slechtste geval, en dat geval komt in de
 * praktijk niet voor. Ter vergelijking: één bestand dat de Builder helemaal
 * herschrijft mag 300.000 tekens groot zijn (MAX_FILE_CONTENT_LENGTH in
 * builder-runtime.ts). Een bestand dat hij alleen mag lézen zuiniger
 * behandelen dan een bestand dat hij herschrijft, was de omgekeerde wereld.
 */
export const MAX_OBJECTIVE_EVIDENCE_CHARS = 40_000;

/**
 * Bestandsextensies die als "broncode van dit project" tellen. Bewust een
 * lijst en geen algemene "iets met een punt erin": anders wordt elke zin met
 * een afkorting of een versienummer een kandidaat-pad.
 */
const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "css", "json", "md", "yml"];

const PATH_PATTERN = new RegExp(
  `[A-Za-z0-9_./@-]*[A-Za-z0-9_-]\\.(?:${SOURCE_EXTENSIONS.join("|")})\\b`,
  "g",
);

/**
 * De schrijfwijzen waarin één pad genoemd kan zijn, op volgorde van
 * waarschijnlijkheid.
 *
 * `@/` wordt `src/`, want zo staat het in tsconfig.json ("@/*" -> "./src/*")
 * en zo importeert dit project 245 van zijn bestanden. Iemand die een pad in
 * een opdracht opschrijft, kopieert het doorgaans uit een importregel.
 */
function candidateSpellings(raw: string): string[] {
  const zonderSlash = raw.replace(/^\/+/, "");

  const varianten = [raw, zonderSlash];

  if (zonderSlash.startsWith("@/")) {
    varianten.push(`src/${zonderSlash.slice(2)}`);
  }

  if (zonderSlash.startsWith("./")) {
    varianten.push(zonderSlash.slice(2));
  }

  return varianten;
}

/**
 * Haalt de repositorypaden uit een vrije tekst.
 *
 * Alleen paden die letterlijk in `treePaths` voorkomen worden teruggegeven.
 * Dat is de hele veiligheidsklep: er wordt niets geraden, niets aangevuld en
 * niets opgehaald wat niet aantoonbaar bestaat.
 *
 * De volgorde van eerste vermelding blijft behouden — wat als eerste genoemd
 * wordt, is doorgaans het belangrijkst.
 */
export function extractRepositoryPaths(
  text: string,
  treePaths: readonly string[],
  maxFiles: number = MAX_OBJECTIVE_EVIDENCE_FILES,
): string[] {
  const known = new Set(treePaths);
  const found: string[] = [];

  for (const match of text.matchAll(PATH_PATTERN)) {
    const candidate = candidateSpellings(match[0]).find((variant) => known.has(variant));

    if (!candidate) continue;
    if (found.includes(candidate)) continue;

    found.push(candidate);

    if (found.length >= maxFiles) break;
  }

  return found;
}

export interface ObjectiveEvidenceFile {
  path: string;
  content: string;
}

/**
 * De naam van de leestool, zodat de melding bij een afgekapt bestand de
 * gebruiker van deze prompt vertelt hoe hij aan de rest komt. Bewust hier
 * herhaald in plaats van builder-tools.ts te importeren: dat bestand trekt de
 * hele gereedschapslaag mee, en dit bestand is met opzet vrij van
 * afhankelijkheden zodat het zonder netwerk getest kan worden.
 */
const READ_FILE_TOOL_NAME = "lees_bestand";

/**
 * Zet de genoemde bestanden om in een promptblok.
 *
 * Nadrukkelijk gelabeld als "alleen om te lezen": zonder die zin is de kans
 * reëel dat het model denkt dat het ze ook mag aanpassen, en dan komt er een
 * bestand in de pull request dat er niet hoort.
 *
 * En nadrukkelijk eerlijk over afkappen: zie de toelichting bij
 * MAX_OBJECTIVE_EVIDENCE_CHARS.
 */
export function formatObjectiveEvidence(files: readonly ObjectiveEvidenceFile[]): string {
  if (files.length === 0) return "";

  const blocks = files.map((file) => {
    const truncated = file.content.length > MAX_OBJECTIVE_EVIDENCE_CHARS;

    return [
      `--- ${file.path} (alleen om te lezen) ---`,
      file.content.slice(0, MAX_OBJECTIVE_EVIDENCE_CHARS),
      // Nooit stilzwijgend afkappen. Zonder deze regel staat er boven een half
      // bestand dat het de volledige huidige inhoud is, en dan moet het model
      // kiezen tussen gokken en weigeren. Zie de toelichting bij
      // MAX_OBJECTIVE_EVIDENCE_CHARS hierboven, en dezelfde les in
      // builder-runtime.ts bij MAX_FILE_CONTENT_LENGTH.
      truncated
        ? `--- LET OP: hierboven staan de eerste ${MAX_OBJECTIVE_EVIDENCE_CHARS} van ${file.content.length} tekens van dit bestand. De rest ontbreekt. Heb je het volledige bestand nodig, vraag het dan op met ${READ_FILE_TOOL_NAME}. ---`
        : "--- einde ---",
    ].join("\n");
  });

  return [
    "Bestanden die in de opdracht genoemd worden. Dit is de huidige, echte inhoud uit de repository — gebruik uitsluitend namen, typen en signaturen die je hier letterlijk ziet staan. Deze bestanden worden NIET door jou geschreven; laat ze ongemoeid.",
    "",
    ...blocks,
  ].join("\n");
}
