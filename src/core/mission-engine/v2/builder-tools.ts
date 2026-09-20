/**
 * Stap 18 (deel 4) — lees- en zoekgereedschap voor de Builder.
 *
 * WAAROM DIT BESTAAT
 *
 * De bewijslaag (stap 10) stelt vooraf samen wat de Builder te zien krijgt:
 * de module onder test en één laag directe imports. Dat werkt goed zolang wij
 * kunnen raden wat hij nodig heeft, en het faalt zodra dat niet zo is.
 *
 * Op 14 september 2026 gebeurde dat, live en zichtbaar. De opdracht droeg de
 * Builder op een type te gebruiken uit een bestand dat niet in de bundel zat,
 * en het model deed precies wat het moest doen — weigeren in plaats van
 * gokken: "Zonder die informatie zou een bewerkingsblok velden moeten
 * veronderstellen, in strijd met je expliciete opdracht om niets te
 * verzinnen." Vier pogingen lang.
 *
 * Er zijn toen twee dingen gebouwd: bestanden die de opdracht met naam noemt
 * gaan automatisch mee (objective-evidence.ts), en het model kan melden dat
 * het iets mist. Allebei lossen ze het geval op waarin iemand vóóraf weet wat
 * er nodig is. Dit bestand lost het geval op waarin niemand dat wist: de
 * Builder mag het zelf opvragen.
 *
 * WAT DIT NADRUKKELIJK NIET IS
 *
 * Geen vervanging van de gedwongen bewijslaag. De hele winst daarvan is dat
 * het bewijs wordt opgedrongen in plaats van dat we hopen dat het model
 * ernaar vraagt; gereedschap brengt dat "hopen dat hij kijkt" via de
 * achterdeur terug. Het komt er dus bovenop, nooit voor in de plaats.
 *
 * Geen schrijfgereedschap. Deze twee lezen en zoeken, meer niet. Schrijven
 * blijft lopen via het vaste pad met de bestandscontroles eromheen (stap 18
 * deel 2 en 3) — anders zou het model langs elke controle heen kunnen
 * schrijven die daar juist voor gebouwd is.
 *
 * Geen uitvoergereedschap. Typecheck en tests draaien kan hier niet, en hoeft
 * ook niet: dat doet de CI, en de missie wacht er sinds 15 september op (zie
 * ci-wait.ts).
 *
 * BEGRENSD, EN ALTIJD MET EEN ANTWOORD
 *
 * Elk gereedschap kent alleen paden die aantoonbaar in de branch staan, kapt
 * grote bestanden af, en geeft bij een fout een leesbare tekst terug in
 * plaats van een uitzondering. Die laatste keuze is bewust: een model dat een
 * verkeerd pad opvraagt moet dat kunnen lezen en zichzelf corrigeren, niet de
 * hele toewijzing laten vallen.
 */

import type { LlmToolCall, LlmToolDefinition } from "@/core/llm/types";

/** Hoeveel tekens er per opgevraagd bestand maximaal teruggaan. */
export const MAX_TOOL_FILE_CHARS = 12_000;

/** Hoeveel paden een zoekopdracht hoogstens teruggeeft. */
export const MAX_TOOL_SEARCH_RESULTS = 40;

/**
 * Hoe vaak de Builder gereedschap mag gebruiken binnen één bestandsschrijfbeurt.
 *
 * Vier. Genoeg om een type op te zoeken, te kijken waar het vandaan komt, en
 * nog twee keer iets na te slaan. Meer is doorgaans geen onderzoek meer maar
 * rondkijken, en elke ronde kost een volledige modelaanroep.
 */
export const MAX_BUILDER_TOOL_ROUNDS = 4;

export const READ_FILE_TOOL = "lees_bestand";
export const SEARCH_FILES_TOOL = "zoek_bestanden";

/**
 * De gereedschapsbeschrijvingen zoals het model ze te lezen krijgt.
 *
 * De omschrijvingen zijn bewust uitgesproken over wanneer je iets gebruikt,
 * niet alleen over wat het doet: dat is de enige sturing die er is op de
 * vraag of het model gereedschap pakt of gaat gokken.
 */
export const BUILDER_TOOL_DEFINITIONS: LlmToolDefinition[] = [
  {
    name: READ_FILE_TOOL,
    description:
      "Geeft de huidige inhoud van één bestand uit deze repository. Gebruik dit zodra je een type, functiesignatuur of constante nodig hebt die je niet letterlijk in de aangeleverde context ziet staan — dus in plaats van aannemen hoe iets eruitziet.",
    parameters: {
      type: "object",
      properties: {
        pad: {
          type: "string",
          description:
            'Het volledige pad vanaf de hoofdmap van de repository, bijvoorbeeld "src/core/mission-engine/v2/mission.ts".',
        },
      },
      required: ["pad"],
      additionalProperties: false,
    },
  },
  {
    name: SEARCH_FILES_TOOL,
    description:
      "Zoekt bestandspaden in deze repository op een stuk tekst uit het pad of de bestandsnaam. Gebruik dit wanneer je wél weet hoe iets heet maar niet waar het staat, en vraag het gevonden bestand daarna op met lees_bestand.",
    parameters: {
      type: "object",
      properties: {
        patroon: {
          type: "string",
          description:
            'Een stuk van het pad of de bestandsnaam, bijvoorbeeld "mission-labels" of "core/llm".',
        },
      },
      required: ["patroon"],
      additionalProperties: false,
    },
  },
];

function stringArgument(call: LlmToolCall, name: string): string | null {
  const value = call.arguments[name];

  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Maakt van een opgegeven pad de schrijfwijze zoals die in de bestandenlijst
 * staat. Voorloopstrepen en het `@/`-alias eruit — zo schrijft een mens (en
 * een importregel) het op.
 */
export function normalizeToolPath(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+/, "");

  if (trimmed.startsWith("@/")) return `src/${trimmed.slice(2)}`;
  if (trimmed.startsWith("./")) return trimmed.slice(2);

  return trimmed;
}

/**
 * Zoekt paden die het patroon bevatten. Hoofdletterongevoelig, want een model
 * dat "MissionLabels" typt bedoelt "mission-labels".
 *
 * Kortere paden eerst: die liggen dichter bij de hoofdmap en zijn vaker het
 * bestand dat bedoeld wordt dan een diep weggestopte naamgenoot.
 */
export function searchTreePaths(
  treePaths: readonly string[],
  pattern: string,
  limit: number = MAX_TOOL_SEARCH_RESULTS,
): string[] {
  const needle = pattern.trim().toLowerCase();

  if (needle === "") return [];

  return treePaths
    .filter((path) => path.toLowerCase().includes(needle))
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, limit);
}

/**
 * Stelt voor één schrijfbeurt de lijst samen van paden waarvan de inhoud al
 * in de opdracht staat.
 *
 * Staat hier als losse functie en niet als regeltje in de lus van
 * writeFiles(), omdat dit de regel is die op 20 september 2026 fout bleek en
 * een missie liet stranden. Een regel die een missie kan laten stranden,
 * hoort een test te hebben.
 *
 * @param currentPath het bestand dat in deze beurt geschreven wordt
 * @param writtenPaths de bestanden uit deze toewijzing die al geschreven zijn
 */
export function shieldedPathsForTurn(
  currentPath: string,
  writtenPaths: readonly string[],
): string[] {
  return [currentPath, ...writtenPaths.filter((path) => path !== currentPath)];
}

export interface BuilderToolRunnerInput {
  /** Alle bestanden die op de missiebranch staan. */
  treePaths: readonly string[];
  /** Haalt de inhoud van één bestand op, of null wanneer die er niet is. */
  readFile: (path: string) => Promise<string | null>;
  /**
   * Paden waarvan de inhoud in déze beurt al op tafel ligt — zie
   * createBuilderToolRunner voor wat dat precies betekent en waarom het niet
   * de hele toewijzing is.
   */
  shieldedPaths?: readonly string[];
  /** Wordt aangeroepen bij elk gebruik, voor het logboek. */
  onUse?: (toolName: string, argument: string, outcome: string) => void;
}

/**
 * Bouwt de functie die één gereedschapsaanroep uitvoert.
 *
 * Alles wat misgaat komt terug als leesbare tekst voor het model: een
 * onbekend gereedschap, een ontbrekend argument, een pad dat niet bestaat.
 * Alleen zo kan het model zich herstellen binnen dezelfde beurt.
 *
 * WELKE BESTANDEN AFGESCHERMD ZIJN, EN WELKE NIET (20 september 2026)
 *
 * Hiervóór stond hier: alle bestanden die de toewijzing schrijft. Dat was te
 * ruim, en het heeft een live missie laten stranden.
 *
 * De opdracht was "breid mission-duration.ts uit en voeg tests toe in
 * mission-duration.test.ts — lees vooraf beide bestanden". De Builder werkt
 * zo'n toewijzing bestand voor bestand af, broncode eerst. In de beurt waarin
 * hij mission-duration.ts schreef, stond het testbestand op de schrijflijst
 * en werd het dus geweigerd — terwijl het daar nog gewoon onaangeroerd op de
 * branch stond en hij het volgens zijn eigen opdracht moest lezen. Hij
 * weigerde te schrijven en zei precies dat. Terecht.
 *
 * De juiste grens is niet "schrijft de toewijzing dit bestand" maar "ligt de
 * inhoud van dit bestand in déze beurt al op tafel". Dat geldt voor twee
 * gevallen, en alleen die twee:
 *
 * - Het bestand dat hij nú schrijft. Zijn huidige inhoud staat al als
 *   "huidige inhoud van dit bestand" in de opdracht.
 * - Een bestand uit deze toewijzing dat hij al geschreven heeft. Dat staat al
 *   in de opdracht met zijn NIEUWE inhoud; het gereedschap zou de oude van de
 *   branch teruggeven, en dan zijn er twee versies in omloop.
 *
 * Een bestand uit de toewijzing dat nog niet aan de beurt is geweest, hoort
 * er niet bij: daarvan is de inhoud op de branch nog wél de echte, en de
 * Builder heeft hem soms nodig om het bestand ervóór goed te kunnen schrijven.
 *
 * Zie writeFiles() in builder-runtime.ts voor waar die lijst per beurt wordt
 * samengesteld.
 */
export function createBuilderToolRunner({
  treePaths,
  readFile,
  shieldedPaths = [],
  onUse,
}: BuilderToolRunnerInput) {
  const known = new Set(treePaths);

  return async function runBuilderTool(call: LlmToolCall): Promise<string> {
    const report = (argument: string, outcome: string, body: string) => {
      onUse?.(call.name, argument, outcome);
      return body;
    };

    if (call.name === SEARCH_FILES_TOOL) {
      const pattern = stringArgument(call, "patroon");

      if (!pattern) {
        return report("", "GEEN_PATROON", 'Geef een "patroon" mee: een stuk van het pad of de bestandsnaam.');
      }

      const matches = searchTreePaths(treePaths, pattern);

      if (matches.length === 0) {
        return report(
          pattern,
          "NIETS_GEVONDEN",
          `Geen enkel bestand in deze repository bevat "${pattern}" in zijn pad. Probeer een korter of ander stuk tekst.`,
        );
      }

      return report(
        pattern,
        `${matches.length}_GEVONDEN`,
        [`Gevonden paden voor "${pattern}":`, ...matches.map((path) => `- ${path}`)].join("\n"),
      );
    }

    if (call.name === READ_FILE_TOOL) {
      const raw = stringArgument(call, "pad");

      if (!raw) {
        return report("", "GEEN_PAD", 'Geef een "pad" mee, vanaf de hoofdmap van de repository.');
      }

      const path = normalizeToolPath(raw);

      if (shieldedPaths.includes(path)) {
        return report(
          path,
          "AL_IN_OPDRACHT",
          `De inhoud van "${path}" staat al in je opdracht hierboven — gebruik die. Wat dit gereedschap teruggeeft is de versie zoals die op de branch staat, en die kan inmiddels achterhaald zijn.`,
        );
      }

      if (!known.has(path)) {
        // Zoeken op de bestandsnaam zónder extensie: een model dat
        // "missions.ts" typt terwijl het bestand "mission.ts" heet, vindt zo
        // alsnog de buurt waar het moet zijn.
        const basename = (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
        const suggestions = searchTreePaths(treePaths, basename, 5);

        return report(
          path,
          "BESTAAT_NIET",
          [
            `"${path}" bestaat niet in deze repository.`,
            ...(suggestions.length > 0
              ? ["Bedoelde je een van deze?", ...suggestions.map((item) => `- ${item}`)]
              : ["Gebruik zoek_bestanden om het juiste pad te vinden."]),
          ].join("\n"),
        );
      }

      const content = await readFile(path);

      if (content === null) {
        return report(
          path,
          "NIET_OPGEHAALD",
          `"${path}" staat wel in de bestandenlijst, maar de inhoud kon niet opgehaald worden. Ga verder zonder dit bestand en verzin de inhoud niet.`,
        );
      }

      const truncated = content.length > MAX_TOOL_FILE_CHARS;

      return report(
        path,
        truncated ? "AFGEKAPT" : "OK",
        [
          `Inhoud van ${path}${truncated ? ` (eerste ${MAX_TOOL_FILE_CHARS} tekens van ${content.length})` : ""}:`,
          content.slice(0, MAX_TOOL_FILE_CHARS),
        ].join("\n"),
      );
    }

    return report(
      "",
      "ONBEKEND_GEREEDSCHAP",
      `"${call.name}" bestaat niet. Beschikbaar zijn: ${BUILDER_TOOL_DEFINITIONS.map((tool) => tool.name).join(", ")}.`,
    );
  };
}
