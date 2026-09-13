/**
 * Context Resolver V1 — de bewijslaag voor de Builder (roadmapstap 10).
 *
 * WAAROM DIT BESTAAT
 *
 * De Builder weet niets buiten zijn opdracht om. Alles wat niet letterlijk
 * in de prompt staat, vult hij aannemelijk in. Dat is de oorzaak achter de
 * mislukte pull requests #24, #26, #27, #29, #30 en #31: testcode tegen een
 * functie waarvan hij de echte naam, parameters en returnwaarde nooit had
 * gezien.
 *
 * builder-runtime.ts stuurde bij een testbestand al wél de volledige inhoud
 * mee van de ANDERE bestanden uit dezelfde toewijzing. Dat helpt alleen als
 * de te testen module toevallig in diezelfde toewijzing wordt geschreven.
 * Bij "schrijf tests voor de bestaande functie X" is er geen ander bestand
 * in de toewijzing, en was dat blok dus leeg — precies het scenario dat
 * telkens misging.
 *
 * Deze module lost dat op door twee soorten bestanden expliciet te
 * onderscheiden:
 *
 * - SCHRIJFBAAR: de bestanden die de toewijzing mag aanmaken of wijzigen.
 * - LEESBAAR BEWIJS: bestanden die de Builder móet zien maar niet mag
 *   aanraken — de module onder test en de bestanden die die module direct
 *   importeert.
 *
 * BEWUST DOM EN DETERMINISTISCH
 *
 * Geen AST-analyse, geen barrel-exports, geen slimme heuristiek: naamgeving
 * en importregels, meer niet. Elke functie hieronder geeft bij dezelfde
 * invoer altijd hetzelfde antwoord, is zonder netwerk te testen, en kent
 * geen "bijna goed": vindt hij de module onder test niet, dan is het
 * antwoord `null` en stopt de toewijzing met INSUFFICIENT_CONTEXT. Liever
 * expliciet stoppen dan stilzwijgend gokken — dezelfde regel als bij het
 * harde falen op te grote bestanden in builder-runtime.ts.
 *
 * AFWIJKING VAN DE ROADMAPTEKST: die zei "geen path-aliassen" om V1 simpel
 * te houden. Dat blijkt hier averechts: dit project importeert 245 keer via
 * `@/...` tegenover 126 keer via een relatief pad, dus zonder aliassen zou
 * het bewijs grotendeels leeg blijven en had stap 10 nauwelijks effect. De
 * omzetting van `@/` is bovendien geen nieuw risico: scripts/verify-imports.mjs
 * doet exact hetzelfde al maandenlang betrouwbaar, en resolveImportSpecifier()
 * hieronder volgt diezelfde regels.
 */

/**
 * Machineleesbare code voor het geval de bewijslaag haar werk niet kan doen.
 * Zelfde opzet als DirectorRuntimeErrorCode in director-runtime.ts (stap 5):
 * de aanroepende laag beslist op `code`, nooit op de bewoording van
 * `message`.
 */
export type BuilderContextErrorCode = "INSUFFICIENT_CONTEXT";

export class BuilderContextError extends Error {
  readonly code: BuilderContextErrorCode;

  constructor(code: BuilderContextErrorCode, message: string) {
    super(message);
    this.name = "BuilderContextError";
    this.code = code;
  }
}

/** Hoeveel bewijsbestanden er maximaal meegaan in één prompt. */
export const MAX_EVIDENCE_FILES = 8;

/**
 * Hoeveel tekens aan bewijs er maximaal meegaan. Ruim onder het
 * contextvenster van het model, maar wél begrensd: zonder grens kan één
 * groot bestand (globals.css is bijna 38.000 tekens) de rest van de prompt
 * verdringen.
 */
export const MAX_EVIDENCE_TOTAL_LENGTH = 120_000;

/** Bestandsextensies die als broncode gelden bij het omzetten van imports. */
const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

/**
 * Normaliseert een pad met `.`- en `..`-stappen naar een schoon pad met
 * schuine strepen. Bewust geen `node:path`: die gebruikt op Windows
 * backslashes, terwijl paden in de GitHub-boom altijd schuine strepen
 * hebben — en zo blijft deze module ook zonder Node te testen.
 */
export function normalizeRepoPath(path: string): string {
  const parts: string[] = [];

  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;

    if (segment === "..") {
      parts.pop();
      continue;
    }

    parts.push(segment);
  }

  return parts.join("/");
}

/** De map waarin een bestand staat ("" voor een bestand in de hoofdmap). */
export function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/**
 * Kandidaatpaden voor de module die bij een testbestand hoort, van meest
 * naar minst specifiek.
 *
 * `builder-runtime.mission-branch.test.ts` hoort bij `builder-runtime.ts`:
 * de naam tussen de module en `.test` beschrijft wélk deel getest wordt.
 * Daarom wordt eerst de volledige naam geprobeerd en daarna telkens één
 * punt-segment van achteren afgehaald:
 *
 *   builder-runtime.mission-branch.test.ts
 *     -> builder-runtime.mission-branch.ts / .tsx
 *     -> builder-runtime.ts / .tsx            <- deze bestaat
 *
 * De extensie van het testbestand zelf komt eerst: een `.test.tsx` hoort
 * eerder bij een component (`.tsx`) dan bij een `.ts`-module.
 *
 * Geeft een lege lijst terug voor een pad dat geen testbestand is.
 */
export function moduleUnderTestCandidates(testPath: string): string[] {
  const match = testPath.match(/^(.*)\.(test|spec)\.(ts|tsx|js|jsx)$/i);
  if (!match) return [];

  const withoutTestSuffix = match[1];
  const testExtension = `.${match[3].toLowerCase()}`;

  const extensions = [
    ...SOURCE_EXTENSIONS.filter((extension) => extension === testExtension),
    ...SOURCE_EXTENSIONS.filter((extension) => extension !== testExtension),
  ];

  const directory = directoryOf(withoutTestSuffix);
  const baseName = withoutTestSuffix.slice(directory === "" ? 0 : directory.length + 1);

  const candidates: string[] = [];
  const segments = baseName.split(".");

  for (let count = segments.length; count >= 1; count--) {
    const name = segments.slice(0, count).join(".");

    for (const extension of extensions) {
      candidates.push(directory === "" ? `${name}${extension}` : `${directory}/${name}${extension}`);
    }
  }

  return candidates;
}

/**
 * Zoekt de module onder test in de bestandenlijst van de repository.
 * Geeft `null` wanneer geen enkele kandidaat bestaat — dan weet de
 * aanroeper dat er onvoldoende bewijs is, in plaats van iets aannemelijks
 * te moeten verzinnen.
 */
export function findModuleUnderTest(testPath: string, treePaths: readonly string[]): string | null {
  const available = new Set(treePaths);

  for (const candidate of moduleUnderTestCandidates(testPath)) {
    if (available.has(candidate)) return candidate;
  }

  return null;
}

/**
 * Haalt de importpaden uit broncode. Zelfde patroon als
 * scripts/verify-imports.mjs gebruikt, zodat beide plekken exact dezelfde
 * imports zien: gewone imports, type-imports, re-exports met een from-deel,
 * en imports zonder binding (alleen om het neveneffect).
 *
 * Let op bij het aanpassen van deze toelichting: verify-imports.mjs leest
 * élk bestand met ditzelfde patroon, dus een voorbeeldregel met een echt
 * ogend importpad in een comment of tekststring wordt door dat script als
 * een échte import van dít bestand gezien en als ontbrekend gemeld. Daarom
 * staan hier geen voorbeeldpaden.
 */
export function extractImportSpecifiers(source: string): string[] {
  const pattern =
    /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/g;

  const found: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    if (!found.includes(match[1])) found.push(match[1]);
  }

  return found;
}

/**
 * Zet één importpad om naar een bestaand bestand in de repository-boom,
 * op dezelfde manier als TypeScript en Next.js dat doen: exact pad, met
 * `.ts`/`.tsx`, of als `index`-bestand van een map.
 *
 * - `@/x` wijst naar `src/x` (zie de paths-instelling in tsconfig.json)
 * - `./x` en `../x` zijn relatief ten opzichte van het importerende bestand
 * - al het andere is een extern pakket en levert `null` op: dat is geen
 *   bewijs uit deze repository en hoeft niet meegestuurd te worden.
 */
export function resolveImportSpecifier(
  fromPath: string,
  specifier: string,
  treePaths: readonly string[],
): string | null {
  let base: string;

  if (specifier.startsWith("@/")) {
    base = normalizeRepoPath(`src/${specifier.slice(2)}`);
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const directory = directoryOf(fromPath);
    base = normalizeRepoPath(directory === "" ? specifier : `${directory}/${specifier}`);
  } else {
    return null;
  }

  if (base === "") return null;

  const available = new Set(treePaths);

  const attempts = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];

  for (const attempt of attempts) {
    if (available.has(attempt)) return attempt;
  }

  return null;
}

/**
 * De bestanden die de module onder test direct importeert — één laag diep,
 * niet dieper.
 *
 * Waarom niet dieper: bij twee lagen groeit het bewijs snel tot tientallen
 * bestanden, en dan verdringt de omvang de bruikbaarheid. Wat de Builder
 * nodig heeft zijn de echte namen en vormen waar de module zelf tegenaan
 * praat; die staan één laag diep.
 */
export function resolveDirectImports(
  modulePath: string,
  moduleSource: string,
  treePaths: readonly string[],
): string[] {
  const resolved: string[] = [];

  for (const specifier of extractImportSpecifiers(moduleSource)) {
    const target = resolveImportSpecifier(modulePath, specifier, treePaths);

    if (target && target !== modulePath && !resolved.includes(target)) {
      resolved.push(target);
    }
  }

  return resolved.sort();
}

/**
 * Een bestaand testbestand als stijl- en frameworkvoorbeeld, bij voorkeur
 * uit dezelfde map als het testbestand dat geschreven wordt.
 *
 * Tot nu toe pakte builder-runtime.ts hiervoor simpelweg het alfabetisch
 * eerste testbestand van de héle repository. Dat had zelden iets met de
 * opdracht te maken. De map is een veel betere aanwijzing: tests naast
 * elkaar testen vergelijkbare code en gebruiken dezelfde mock-aanpak.
 *
 * Is er in die map geen ander testbestand, dan wordt de zoekruimte stap voor
 * stap verbreed: eerst alles ónder die map, daarna een map omhoog, enzovoort.
 * Volledig deterministisch, want binnen elke stap wordt alfabetisch gekozen.
 * Er komt alleen `null` uit wanneer de repository helemaal geen testbestanden
 * bevat.
 */
export function findExampleTestFile(
  testPath: string,
  treePaths: readonly string[],
  excludedPaths: readonly string[] = [],
): string | null {
  const excluded = new Set([testPath, ...excludedPaths]);

  const candidates = treePaths
    .filter((path) => !excluded.has(path))
    .filter((path) => /\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(path))
    .sort();

  if (candidates.length === 0) return null;

  let directory = directoryOf(testPath);

  while (true) {
    // Eerst de map zelf: een test die er letterlijk naast staat, test
    // vergelijkbare code en gebruikt dezelfde mock-aanpak.
    const inDirectory = candidates.filter((path) => directoryOf(path) === directory);
    if (inDirectory.length > 0) return inDirectory[0];

    // Daarna alles wat ónder die map valt, vóórdat we een map omhoog gaan.
    const below = candidates.filter(
      (path) => directory === "" || path.startsWith(`${directory}/`),
    );
    if (below.length > 0) return below[0];

    if (directory === "") return null;
    directory = directoryOf(directory);
  }
}

/**
 * Stap 18 (eerste deel) — doorkijken door doorverwijzingen.
 *
 * `resolveDirectImports` hierboven gaat bewust één laag diep, en die grens
 * blijft staan: bij twee volle lagen groeit het bewijs tot tientallen
 * bestanden en verdringt de omvang de bruikbaarheid.
 *
 * Maar één laag is soms één laag te weinig, en dat is live gebleken. Bij PR
 * #54 ("Tests voor de Knowledge Review Agent") lag het type dat je nodig hebt
 * om een mock-signatuur te beoordelen twee stappen verderop, en viel het dus
 * buiten de bundel. Niet omdat de bundel te klein was, maar omdat er een
 * bestand tussen zat dat zelf niets zei.
 *
 * Dit blok lost dat gericht op, zonder de grens op te rekken:
 *
 * - Een **barrel** — een bestand dat vrijwel alleen maar doorverwijst — wordt
 *   VERVANGEN door waar het naar doorverwijst. Dat is geen extra laag maar een
 *   ruil: een bestand zonder inhoud eruit, het bestand met de echte vorm erin.
 *   Bij gelijk budget strikt beter bewijs.
 * - Alleen voor **type-imports** komt er één extra hop bij. Types zijn precies
 *   de vorminformatie die de Builder nodig heeft om een aanroep of een mock
 *   goed te krijgen; gewone imports zijn dat meestal niet. Begrensd op een
 *   handvol, en pas achteraan in de volgorde, zodat ze alleen meegaan als er
 *   ruimte over is.
 *
 * De harde bovengrens blijft ongemoeid: `selectEvidenceWithinBudget` kapt nog
 * steeds af op MAX_EVIDENCE_FILES en MAX_EVIDENCE_TOTAL_LENGTH. Wat hier
 * gebeurt, verandert alleen WELKE bestanden de eerste plekken krijgen.
 */

/** Hoeveel extra type-dragende bestanden er hooguit bijkomen. */
export const MAX_TYPE_HOP_FILES = 3;

/**
 * Verwijdert commentaar, zodat een voorbeeldregel in een toelichting niet als
 * echte code wordt geteld. Bewust simpel: dit hoeft geen parser te zijn, het
 * hoeft alleen te voorkomen dat commentaar meetelt bij de vraag "staat hier
 * nog iets anders dan doorverwijzingen?".
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/**
 * Een barrel is een bestand dat alleen maar doorverwijst: minstens één
 * `export … from …`, en verder niets van betekenis. De inhoud van zo'n
 * bestand vertelt de Builder niets over vorm of gedrag — het bestand
 * waarnaar het verwijst wél.
 *
 * Bij twijfel `false`: staat er behalve doorverwijzingen ook maar iets
 * inhoudelijks, dan is het een gewoon bestand en blijft het gewoon bewijs.
 * Liever een nutteloos bestand te veel dan een nuttig bestand vervangen door
 * iets anders.
 */
export function isBarrelModule(source: string): boolean {
  const cleaned = stripComments(source);

  const reExportPattern = /(?:^|\n)\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+["'][^"']+["'];?/g;

  const reExports = cleaned.match(reExportPattern) ?? [];
  if (reExports.length === 0) return false;

  const remainder = cleaned.replace(reExportPattern, "").trim();

  return remainder === "";
}

/**
 * De importpaden die uitsluitend een type binnenhalen: `import type …` en
 * `export type … from …`. Een gewone import die toevallig ook een type
 * meeneemt telt hier niet mee — die staat al in de eerste laag.
 */
export function extractTypeOnlyImportSpecifiers(source: string): string[] {
  const pattern =
    /(?:import|export)\s+type\s+(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/g;

  const found: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(stripComments(source))) !== null) {
    if (!found.includes(match[1])) found.push(match[1]);
  }

  return found;
}

export interface RefineEvidenceInput {
  modulePath: string;
  moduleSource: string;
  /** De uitkomst van resolveDirectImports voor deze module. */
  directImports: readonly string[];
  /** Inhoud van die directe imports, zoals opgehaald door de aanroeper. */
  sources: ReadonlyMap<string, string>;
  treePaths: readonly string[];
  maxTypeHopFiles?: number;
}

export interface RefinedEvidence {
  /** Barrels die plaatsmaken voor de bestanden waar ze naar doorverwijzen. */
  replacements: Array<{ barrelPath: string; targets: string[] }>;
  /** Extra bestanden die de vorm dragen, één type-hop verderop. */
  additional: string[];
}

/**
 * Bepaalt, op grond van de al opgehaalde inhoud van de directe imports, welk
 * bewijs beter is dan wat er nu ligt.
 *
 * Blijft net als de rest van dit bestand volledig deterministisch en
 * netwerkloos: de aanroeper levert de inhoud aan, deze functie beslist alleen.
 */
export function refineEvidenceImports({
  modulePath,
  moduleSource,
  directImports,
  sources,
  treePaths,
  maxTypeHopFiles = MAX_TYPE_HOP_FILES,
}: RefineEvidenceInput): RefinedEvidence {
  const replacements: Array<{ barrelPath: string; targets: string[] }> = [];
  const seen = new Set<string>([modulePath, ...directImports]);

  for (const importPath of directImports) {
    const source = sources.get(importPath);
    if (!source || !isBarrelModule(source)) continue;

    const targets: string[] = [];

    for (const specifier of extractImportSpecifiers(source)) {
      const target = resolveImportSpecifier(importPath, specifier, treePaths);

      if (target && target !== modulePath && !targets.includes(target)) {
        targets.push(target);
      }
    }

    if (targets.length > 0) {
      replacements.push({ barrelPath: importPath, targets: targets.sort() });
      for (const target of targets) seen.add(target);
    }
  }

  // Eén extra hop, uitsluitend via type-imports van de module onder test, en
  // alleen naar bestanden die we nog niet hebben.
  const additional: string[] = [];

  for (const specifier of extractTypeOnlyImportSpecifiers(moduleSource)) {
    if (additional.length >= maxTypeHopFiles) break;

    const first = resolveImportSpecifier(modulePath, specifier, treePaths);
    if (!first) continue;

    const firstSource = sources.get(first);
    if (!firstSource) continue;

    for (const nested of extractTypeOnlyImportSpecifiers(firstSource)) {
      if (additional.length >= maxTypeHopFiles) break;

      const target = resolveImportSpecifier(first, nested, treePaths);

      if (target && !seen.has(target)) {
        seen.add(target);
        additional.push(target);
      }
    }
  }

  return { replacements, additional: additional.sort() };
}

export interface EvidenceFile {
  path: string;
  content: string;
}

export interface EvidenceSelection {
  /** Bestanden die daadwerkelijk in de prompt komen, in deze volgorde. */
  included: EvidenceFile[];
  /** Bestanden die niet meepassen, met de reden — komt letterlijk in het manifest. */
  omitted: Array<{ path: string; reason: string }>;
}

/**
 * Kiest welk bewijs binnen het budget past.
 *
 * De volgorde van `candidates` is de volgorde van belangrijkheid (de module
 * onder test hoort dus eerst te staan). Wat niet past, verdwijnt niet
 * stilzwijgend maar komt in `omitted` terecht en daarmee in het manifest:
 * de Builder hoort te weten wat hij NIET gezien heeft. Precies dat ontbrak
 * bij het afkappen van globals.css, waar een halve weergave werd
 * gepresenteerd als de volledige inhoud.
 */
export function selectEvidenceWithinBudget(
  candidates: readonly EvidenceFile[],
  maxFiles: number = MAX_EVIDENCE_FILES,
  maxTotalLength: number = MAX_EVIDENCE_TOTAL_LENGTH,
): EvidenceSelection {
  const included: EvidenceFile[] = [];
  const omitted: Array<{ path: string; reason: string }> = [];

  let usedLength = 0;

  for (const candidate of candidates) {
    if (included.length >= maxFiles) {
      omitted.push({
        path: candidate.path,
        reason: `niet meegestuurd: maximaal ${maxFiles} bewijsbestanden per opdracht`,
      });
      continue;
    }

    if (usedLength + candidate.content.length > maxTotalLength) {
      omitted.push({
        path: candidate.path,
        reason: `niet meegestuurd: past niet binnen de ruimte voor bewijs (${candidate.content.length} tekens)`,
      });
      continue;
    }

    included.push(candidate);
    usedLength += candidate.content.length;
  }

  return { included, omitted };
}

export interface ContextManifestInput {
  /** Bestanden die deze toewijzing mag aanmaken of wijzigen. */
  writablePaths: readonly string[];
  /** Bewijs dat volledig is meegestuurd. */
  evidence: EvidenceSelection;
  /** Het meegestuurde stijlvoorbeeld, indien aanwezig. */
  examplePath?: string | null;
  /**
   * Stap 18: barrels die zijn vervangen door waar ze naar doorverwijzen.
   * Staat in het manifest omdat de Builder anders een importpad zou kunnen
   * gebruiken dat hij nergens heeft zien staan: hij ziet de inhoud van het
   * doelbestand, maar de rest van de codebase importeert via de barrel. Door
   * beide te noemen weet hij dat allebei de paden echt bestaan.
   */
  followedThrough?: ReadonlyArray<{ barrelPath: string; targets: readonly string[] }>;
}

/**
 * Het contextmanifest: bovenaan de opdracht, in gewone taal, wat de Builder
 * daadwerkelijk heeft gezien en wat niet.
 *
 * Dit is geen samenvatting achteraf maar een instructie vooraf: alleen wat
 * hier staat mag hij als bestaand beschouwen. Staat een bestand bij "niet
 * meegestuurd", dan weet hij dat hij daar niets over kan weten — in plaats
 * van dat de afwezigheid ervan onzichtbaar blijft en hij de leegte invult.
 */
export function buildContextManifest({
  writablePaths,
  evidence,
  examplePath = null,
  followedThrough = [],
}: ContextManifestInput): string {
  const lines: string[] = ["CONTEXTMANIFEST — dit is alles wat je hebt gezien:"];

  lines.push("", "Bestanden die je in deze opdracht mag schrijven:");
  for (const path of writablePaths) {
    lines.push(`- ${path}`);
  }

  if (evidence.included.length > 0) {
    lines.push(
      "",
      "Bestanden die je hieronder volledig te lezen krijgt (bewijs — NIET wijzigen):",
    );
    for (const file of evidence.included) {
      lines.push(`- ${file.path}`);
    }
  }

  if (followedThrough.length > 0) {
    lines.push(
      "",
      "Doorverwijzende bestanden (barrels) zijn vervangen door waar ze naar verwijzen. Beide paden bestaan echt, dus beide mag je gebruiken in een import:",
    );
    for (const entry of followedThrough) {
      lines.push(`- ${entry.barrelPath} verwijst door naar ${entry.targets.join(", ")}`);
    }
  }

  if (examplePath) {
    lines.push("", `Meegestuurd als stijlvoorbeeld: ${examplePath}`);
  }

  if (evidence.omitted.length > 0) {
    lines.push("", "NIET meegestuurd — hierover weet je dus niets:");
    for (const entry of evidence.omitted) {
      lines.push(`- ${entry.path} (${entry.reason})`);
    }
  }

  lines.push(
    "",
    "Elke functienaam, parameter, returnwaarde en importpad die je gebruikt moet letterlijk voorkomen in de bestanden hierboven of in de inhoud hieronder. Komt iets daar niet in voor, dan bestaat het niet en mag je het niet gebruiken — ook niet als het aannemelijk lijkt.",
  );

  return lines.join("\n");
}
