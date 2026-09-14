/**
 * Stap 18 (deel 3) — mechanische controle op verzonnen imports.
 *
 * WAAROM DIT BESTAAT
 *
 * Dit is geen theoretisch risico. Er is een live misser waar dit hele
 * vangnet uit voortkomt: QA keurde een pull request op alle succescriteria
 * goed terwijl de CI faalde op drie verzonnen imports die nergens bestonden
 * (zie de toelichting bij `ensureMissionPullRequestMerged` in
 * director-runtime.ts). Daar zijn destijds twee dingen tegen gebouwd — de
 * bewijslaag (stap 10), die de Builder de échte broncode voorschotelt, en de
 * CI-statuscontrole, die weigert te mergen bij een rode check.
 *
 * Allebei goed, en allebei indirect. De bewijslaag hoopt dat het model beter
 * schrijft als het beter geïnformeerd is; de CI merkt het pas nadat er
 * gecommit en gepusht is, wat een hele herstelronde kost. Deze module zit
 * ertussenin: vóór de commit, en zonder model — hij kijkt gewoon of de naam
 * die de Builder importeert daadwerkelijk ergens geëxporteerd wordt.
 *
 * WAT HIJ WÉL EN NIET CONTROLEERT
 *
 * Wel: bestaat de geïmporteerde naam als export in het doelbestand. Dat is
 * mechanisch vast te stellen en dekt precies de fout die is opgetreden.
 *
 * Niet: of het aantal parameters klopt, of de typen kloppen, of de aanroep
 * zinnig is. Dat vraagt een echte typechecker, en die draait al in de CI.
 * Een halve typechecker nabouwen met reguliere expressies levert vooral
 * onterechte alarmen op, en die zijn hier duurder dan een gemiste controle:
 * een onterecht geblokkeerde toewijzing kost een hele ronde en ondermijnt
 * het vertrouwen in de controle zelf.
 *
 * DAAROM: BIJ TWIJFEL NIETS MELDEN
 *
 * Elke onzekerheid leidt tot overslaan, nooit tot een melding. Geen melding
 * wanneer het importpad buiten deze repository wijst, wanneer de inhoud van
 * het doelbestand niet beschikbaar is, of wanneer dat doelbestand een
 * `export *`-regel bevat — dan is de lijst met namen aantoonbaar onvolledig
 * en kan afwezigheid niets bewijzen. Liever een verzonnen import die
 * doorglipt (de CI vangt hem alsnog) dan een echte import die onterecht
 * wordt geweigerd.
 */

/** Een importregel met de namen die er letterlijk uit gehaald worden. */
export interface NamedImport {
  specifier: string;
  /** Alleen benoemde bindingen. Default- en namespace-imports staan hier niet in. */
  names: string[];
}

export interface ModuleExports {
  names: string[];
  /**
   * false wanneer het bestand een `export *`-regel bevat. De namenlijst is
   * dan onvolledig, en mag dus niet gebruikt worden om iets af te wijzen.
   */
  complete: boolean;
}

export interface UnknownImport {
  /** Het bestand dat de import doet. */
  fromPath: string;
  specifier: string;
  /** Het bestand waar het importpad naartoe wijst. */
  targetPath: string;
  missingNames: string[];
  /** Wat daar wél geëxporteerd wordt — dit hoort in de foutmelding. */
  availableNames: string[];
}

/**
 * Haalt commentaar weg, en ook het onzichtbare BOM-teken (U+FEFF) dat sommige
 * bestanden vooraan hebben staan.
 *
 * Dat laatste is geen theoretische netheid. De patronen hieronder verankeren
 * op het begin van een regel, en een BOM zit daar tussen het regelbegin en het
 * woord `export` in — waardoor de EERSTE export van zo'n bestand niet gezien
 * werd. Gevonden door deze controle los te laten op de eigen codebase:
 * `src/core/workflows/types.ts` begint met een BOM, en drie bestanden die
 * daar `WorkflowRole` uit importeren werden daardoor onterecht als fout
 * gemeld. Precies de valse alarmen die deze module hoort te vermijden.
 */
function stripComments(source: string): string {
  return source
    .replace(/﻿/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/**
 * Haalt per naam de daadwerkelijke binding eruit: bij `A as B` is `B` de naam
 * waaronder hij binnenkomt, maar `A` de naam die in het doelbestand moet
 * bestaan. Die eerste is dus wat we controleren.
 */
function parseImportClauseNames(clause: string): string[] {
  const braces = clause.match(/\{([^}]*)\}/);
  if (!braces) return [];

  return braces[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/**
 * De benoemde imports uit een bestand.
 *
 * Bewust verankerd aan het begin van een regel: een echte import staat op het
 * hoogste niveau van een bestand. Dat sluit meteen de meeste importachtige
 * tekst uit die toevallig in een string of sjabloon staat.
 */
export function extractNamedImports(source: string): NamedImport[] {
  const pattern = /^[ \t]*import\s+(?:type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/gm;
  const cleaned = stripComments(source);

  const found: NamedImport[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleaned)) !== null) {
    const names = parseImportClauseNames(match[1]);
    if (names.length === 0) continue;

    const existing = found.find((entry) => entry.specifier === match![2]);

    if (existing) {
      for (const name of names) {
        if (!existing.names.includes(name)) existing.names.push(name);
      }
      continue;
    }

    found.push({ specifier: match[2], names });
  }

  return found;
}

/**
 * De namen die een bestand exporteert.
 *
 * Bij `export { A as B }` is `B` de naam waaronder het naar buiten komt — dat
 * is dus de naam die een importeur moet gebruiken, en die hier in de lijst
 * hoort. Precies andersom als bij imports hierboven.
 */
export function extractExportedNames(source: string): ModuleExports {
  const cleaned = stripComments(source);
  const names: string[] = [];

  const add = (name: string) => {
    if (name && !names.includes(name)) names.push(name);
  };

  const declarationPattern =
    /^[ \t]*export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

  let match: RegExpExecArray | null;

  while ((match = declarationPattern.exec(cleaned)) !== null) {
    add(match[1]);
  }

  const listPattern = /^[ \t]*export\s+(?:type\s+)?\{([^}]*)\}/gm;

  while ((match = listPattern.exec(cleaned)) !== null) {
    for (const entry of match[1].split(",")) {
      const parts = entry.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      const exported = (parts[1] ?? parts[0] ?? "").trim();

      if (/^[A-Za-z_$][\w$]*$/.test(exported)) add(exported);
    }
  }

  if (/^[ \t]*export\s+default\b/m.test(cleaned)) {
    add("default");
  }

  const complete = !/^[ \t]*export\s+\*/m.test(cleaned);

  return { names, complete };
}

export interface FindUnknownImportsInput {
  /** Pad van het bestand dat zojuist geschreven is. */
  path: string;
  source: string;
  /** Zet een importpad om naar een pad in de repository, of null. */
  resolve: (fromPath: string, specifier: string) => string | null;
  /** Geeft de inhoud van een bestand, of null wanneer die niet beschikbaar is. */
  readSource: (path: string) => string | null;
}

/**
 * Zoekt imports die verwijzen naar een naam die in het doelbestand niet
 * bestaat. Geeft een lege lijst wanneer er niets mis is — of wanneer er
 * onvoldoende zekerheid is om iets te durven zeggen.
 */
export function findUnknownImports({
  path,
  source,
  resolve,
  readSource,
}: FindUnknownImportsInput): UnknownImport[] {
  const problems: UnknownImport[] = [];

  for (const imported of extractNamedImports(source)) {
    const targetPath = resolve(path, imported.specifier);

    // Buiten deze repository (een pakket uit node_modules): niets over te
    // zeggen, dus niets zeggen.
    if (!targetPath) continue;

    const targetSource = readSource(targetPath);
    if (targetSource === null) continue;

    const exports = extractExportedNames(targetSource);

    // `export *` betekent dat de namenlijst onvolledig is. Afwezigheid bewijst
    // dan niets.
    if (!exports.complete) continue;

    const missingNames = imported.names.filter((name) => !exports.names.includes(name));

    if (missingNames.length > 0) {
      problems.push({
        fromPath: path,
        specifier: imported.specifier,
        targetPath,
        missingNames,
        availableNames: exports.names,
      });
    }
  }

  return problems;
}

/** Maakt er een melding van die zegt wat er mis is én wat er wél bestaat. */
export function describeUnknownImports(problems: readonly UnknownImport[]): string {
  const lines = problems.map((problem) => {
    const missing = problem.missingNames.map((name) => `"${name}"`).join(", ");
    const available =
      problem.availableNames.length > 0
        ? problem.availableNames.join(", ")
        : "(dat bestand exporteert niets)";

    return `- In ${problem.fromPath} importeer je ${missing} uit "${problem.specifier}", maar ${problem.targetPath} exporteert die naam niet. Wat daar wél geëxporteerd wordt: ${available}.`;
  });

  return [
    "De geschreven code importeert namen die niet bestaan:",
    ...lines,
    "Gebruik uitsluitend namen die daadwerkelijk geëxporteerd worden, of pas het importpad aan.",
  ].join("\n");
}
