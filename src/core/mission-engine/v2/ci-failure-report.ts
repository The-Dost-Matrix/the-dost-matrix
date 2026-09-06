/**
 * Leesbaar maken van een gefaalde CI-controle (roadmapstap 11, deel 1).
 *
 * WAAROM DIT BESTAAT
 *
 * Tot nu toe wist de app bij een rode CI alleen de NAAM van de gefaalde
 * controle: "CI / Typecheck & import-check". Dat is genoeg om te weigeren te
 * mergen — dat doet de Director al sinds stap 7 — maar veel te weinig om er
 * iets aan te repareren. Een Builder die alleen te horen krijgt dát de
 * typecheck faalde, gaat precies datgene doen wat we met stap 10 hebben
 * weggehaald: aannemelijk invullen wat hij niet weet.
 *
 * Deze module zet de ruwe gegevens van GitHub om in één compact, feitelijk
 * verslag: welke controle faalde, welke bestanden en regels GitHub aanwijst,
 * en de relevante regels uit het logboek van de gefaalde taak.
 *
 * Bewust volledig zonder netwerk: alle GitHub-aanroepen staan in
 * github-client.ts, alle beslissingen hier. Zo is dit zonder GitHub te
 * testen — dezelfde scheiding als bij context-resolver.ts in stap 10.
 *
 * EERLIJK OVER WAT ONTBREEKT
 *
 * Het logboek van een taak vraagt de permissie "Actions: Read" op de GitHub
 * App. Is die er niet, dan valt dat deel weg. Het verslag zegt dan
 * expliciet dát het ontbreekt en waarom, in plaats van een verslag te tonen
 * dat compleet lijkt maar het niet is. Zelfde regel als bij het
 * contextmanifest van stap 10 en bij het afkappen van globals.css: iets
 * weglaten mag, doen alsof er niets weggelaten is niet.
 */

/** Bovengrens voor het hele verslag, zodat het in een prompt past. */
export const MAX_REPORT_LENGTH = 12_000;

/** Hoeveel logregels er maximaal per gefaalde controle worden overgenomen. */
export const MAX_LOG_LINES = 60;

/**
 * Regels die erop wijzen dat hier de daadwerkelijke fout staat. Bewust een
 * simpele lijst en geen slimme parser: dit hoeft niet perfect te zijn, het
 * hoeft alleen de honderden regels installatie- en cache-uitvoer weg te
 * laten die vóór de echte fout staan.
 */
const ERROR_LINE_PATTERN =
  /\b(error|errors|failed|failing|failure|cannot find|does not exist|is not assignable|expected|received|assertionerror|✗|×|FAIL)\b/i;

/** Regels die juist ruis zijn, ook al bevatten ze een woord uit de lijst hierboven. */
const NOISE_LINE_PATTERN =
  /(npm warn|deprecated|##\[group\]|##\[endgroup\]|Downloading|Receiving objects|resolving deltas)/i;

/**
 * Haalt het taaknummer uit de `details_url` van een check-run.
 *
 * GitHub geeft die URL in de vorm
 * `https://github.com/<eigenaar>/<repo>/actions/runs/<runId>/job/<jobId>`.
 * Het taaknummer is nodig om het logboek van precies die taak op te halen.
 *
 * Bewust op de URL en niet op de aanname dat het nummer van de check-run
 * gelijk is aan dat van de taak: dat klopt in de praktijk vaak, maar het is
 * nergens door GitHub toegezegd, en een stille verwisseling zou het logboek
 * van een andere taak opleveren.
 */
export function extractJobIdFromDetailsUrl(detailsUrl: string | null | undefined): string | null {
  if (!detailsUrl) return null;

  const match = detailsUrl.match(/\/actions\/runs\/\d+\/job\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Haalt het tijdstempel weg dat GitHub vooraan elke logregel zet
 * (`2026-09-06T15:04:05.1234567Z `). Dat is per regel ruim dertig tekens die
 * niets toevoegen en wél ruimte kosten in de prompt.
 */
export function stripLogTimestamp(line: string): string {
  return line.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/, "");
}

/**
 * Knijpt een volledig taaklogboek samen tot de regels die er echt toe doen.
 *
 * Werkwijze, in deze volgorde:
 * 1. tijdstempels weghalen en lege regels overslaan;
 * 2. regels zoeken die op een fout wijzen, met de regel ervoor en erna als
 *    context (een typecheck-fout staat vaak op de regel ná het bestandspad);
 * 3. is er niets gevonden, dan de laatste regels nemen — bij een taak die om
 *    een andere reden stukloopt staat de oorzaak vrijwel altijd onderaan.
 *
 * Het resultaat behoudt de oorspronkelijke volgorde en markeert elk
 * weggelaten stuk met "[...]" — ook aan het begin en het eind, niet alleen
 * tussen twee bewaarde regels. Zonder die markering aan het begin zou het
 * eruitzien alsof het logboek bij de foutregel begint, terwijl er honderden
 * regels vóór zijn weggelaten. Dat is dezelfde soort stille misleiding als
 * het afkappen van globals.css destijds.
 */
export function condenseJobLog(log: string, maxLines: number = MAX_LOG_LINES): string {
  const lines = log
    .split(/\r?\n/)
    .map(stripLogTimestamp)
    .map((line) => line.trimEnd());

  const interesting = new Set<number>();

  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    if (NOISE_LINE_PATTERN.test(line)) return;
    if (!ERROR_LINE_PATTERN.test(line)) return;

    interesting.add(index);
    if (index > 0) interesting.add(index - 1);
    if (index + 1 < lines.length) interesting.add(index + 1);
  });

  let selected = [...interesting].sort((left, right) => left - right);

  if (selected.length === 0) {
    const nonEmpty = lines
      .map((line, index) => ({ line, index }))
      .filter((entry) => entry.line.trim() !== "");

    selected = nonEmpty.slice(-maxLines).map((entry) => entry.index);
  }

  if (selected.length > maxLines) {
    // De laatste regels zijn het meest zeggend: daar staat de samenvatting
    // van de testrunner of de laatste compileerfout.
    selected = selected.slice(-maxLines);
  }

  if (selected.length === 0) return "";

  // Index van de laatste regel met inhoud: alles daarna is lege ruimte en
  // telt niet als "weggelaten".
  let lastMeaningfulIndex = lines.length - 1;
  while (lastMeaningfulIndex >= 0 && lines[lastMeaningfulIndex].trim() === "") {
    lastMeaningfulIndex--;
  }

  const output: string[] = [];
  let previousIndex: number | null = null;

  for (const index of selected) {
    if (previousIndex === null) {
      if (index > 0) output.push("[...]");
    } else if (index > previousIndex + 1) {
      output.push("[...]");
    }

    output.push(lines[index]);
    previousIndex = index;
  }

  if (previousIndex !== null && previousIndex < lastMeaningfulIndex) {
    output.push("[...]");
  }

  return output.join("\n").trim();
}

export interface CiFailureAnnotation {
  path: string;
  startLine: number | null;
  level: string;
  message: string;
}

export interface CiFailureInput {
  /** Naam van de gefaalde controle, zoals GitHub die toont. */
  checkName: string;
  /** Korte titel die de controle zelf meegaf, indien aanwezig. */
  outputTitle?: string | null;
  /** Samenvatting die de controle zelf meegaf, indien aanwezig. */
  outputSummary?: string | null;
  /** Door GitHub aangewezen bestanden en regels, indien aanwezig. */
  annotations: readonly CiFailureAnnotation[];
  /** Ruw logboek van de gefaalde taak, of null wanneer het niet is opgehaald. */
  jobLog: string | null;
  /**
   * Waarom het logboek ontbreekt. Komt letterlijk in het verslag te staan,
   * zodat een lezer (mens of Builder) weet dat hier iets mist en waarom —
   * in plaats van een verslag te zien dat compleet oogt.
   */
  jobLogUnavailableReason?: string | null;
}

/**
 * Bouwt het verslag dat zowel de eigenaar in de app te zien krijgt als,
 * later, de Builder bij een herstelpoging.
 */
export function formatCiFailureReport(
  failures: readonly CiFailureInput[],
  maxLength: number = MAX_REPORT_LENGTH,
): string {
  if (failures.length === 0) {
    return "Geen gefaalde CI-controles gevonden om te beschrijven.";
  }

  const sections: string[] = [];

  for (const failure of failures) {
    const lines: string[] = [`Gefaalde controle: ${failure.checkName}`];

    if (failure.outputTitle?.trim()) {
      lines.push(`Melding: ${failure.outputTitle.trim()}`);
    }

    if (failure.outputSummary?.trim()) {
      lines.push(`Samenvatting: ${failure.outputSummary.trim()}`);
    }

    if (failure.annotations.length > 0) {
      lines.push("", "Door GitHub aangewezen plekken:");
      for (const annotation of failure.annotations) {
        const location =
          annotation.startLine === null
            ? annotation.path
            : `${annotation.path}:${annotation.startLine}`;
        lines.push(`- ${location} (${annotation.level}): ${annotation.message}`);
      }
    }

    if (failure.jobLog) {
      const condensed = condenseJobLog(failure.jobLog);
      if (condensed) {
        lines.push("", "Relevante regels uit het logboek van deze taak:", condensed);
      }
    } else {
      lines.push(
        "",
        `Het logboek van deze taak is NIET opgehaald${
          failure.jobLogUnavailableReason ? `: ${failure.jobLogUnavailableReason}` : "."
        } De foutmelding hierboven is daardoor mogelijk onvolledig.`,
      );
    }

    sections.push(lines.join("\n"));
  }

  const report = sections.join("\n\n---\n\n");

  if (report.length <= maxLength) return report;

  return `${report.slice(0, maxLength)}\n\n[verslag afgekapt op ${maxLength} tekens]`;
}
