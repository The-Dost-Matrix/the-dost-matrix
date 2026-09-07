/**
 * Actuele projectstand voor de Director-chat.
 *
 * WAAROM DIT BESTAAT
 *
 * Gevraagd "zijn er nog taken die aandacht nodig hebben?" gaf de Director een
 * lijst die grotendeels achterhaald was: hij vroeg om missies te sluiten die
 * al gesloten waren, om tellers te controleren die diezelfde dag verwijderd
 * waren, en om lessen te vertalen naar controles die al gebouwd waren. Hij
 * zei het zelf in zijn eerste zin: "Ik kan de actuele Firestore-status hier
 * niet zelf vaststellen."
 *
 * Dat was letterlijk waar en toch misleidend. Hij kán de projectbestanden
 * lezen (zie de <workspace-read>-instructie in chat-service.ts) en de
 * roadmap staat gewoon in de repository. Hij deed het alleen niet uit
 * zichzelf, en baseerde zich op wat er ooit in een gesprek langskwam.
 *
 * Dit is dezelfde fout als bij de Builder vóór stap 10 en bij QA vóór stap
 * 12, nu bij de Director: een oordeel geven zonder het bewijs erbij. En de
 * oplossing is dezelfde, want die heeft zich inmiddels drie keer bewezen:
 * niet hopen dat het model gaat kijken, maar de feiten vóór hem neerleggen —
 * elke beurt opnieuw, zonder dat hij erom hoeft te vragen.
 *
 * WAT ER WEL EN NIET IN GAAT
 *
 * Bewust een INDEX van de roadmap (de kopjes, met per kop of hij onder
 * "Voltooid" staat of onder de voorstellen) en niet de volledige tekst: die
 * is tienduizenden tekens groot en zou elke chatbeurt duurder maken zonder
 * dat het de vraag "wat is er af?" beter beantwoordt. Heeft hij details
 * nodig, dan kan hij docs/roadmap.md alsnog zelf opvragen.
 *
 * Van de missies alleen status en titel, om dezelfde reden.
 *
 * Deze module is volledig zonder netwerk of bestandssysteem: alleen tekst in,
 * tekst uit. Het ophalen gebeurt in chat-service.ts. Dezelfde scheiding als
 * bij context-resolver.ts en ci-failure-report.ts.
 */

/** Hoeveel roadmapkopjes er maximaal in het blok komen. */
export const MAX_ROADMAP_ENTRIES = 60;

/** Hoeveel missies er maximaal in het blok komen. */
export const MAX_MISSION_ENTRIES = 20;

export interface RoadmapEntry {
  /** Het "##"-kopje waar dit onder valt, bijvoorbeeld "Voltooid". */
  section: string;
  /** Het "###"-kopje zelf. */
  title: string;
}

/**
 * Leest de kopjesstructuur van de roadmap uit.
 *
 * Alleen "##" en "###" — dieper genest komt in dit bestand niet voor, en de
 * indeling die ertoe doet is precies die twee niveaus: welke stappen staan
 * onder "Voltooid" en welke onder de voorstellen.
 *
 * Kopjes binnen een codeblok worden overgeslagen: een regel die met "### "
 * begint binnen ``` is geen kop maar inhoud.
 */
export function extractRoadmapEntries(markdown: string): RoadmapEntry[] {
  const entries: RoadmapEntry[] = [];
  let section = "(zonder kop)";
  let insideCodeBlock = false;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (line.trimStart().startsWith("```")) {
      insideCodeBlock = !insideCodeBlock;
      continue;
    }

    if (insideCodeBlock) continue;

    if (line.startsWith("## ")) {
      section = line.slice(3).trim();
      continue;
    }

    if (line.startsWith("### ")) {
      entries.push({ section, title: line.slice(4).trim() });
    }
  }

  return entries;
}

/** De index als leesbare tekst, gegroepeerd per hoofdkop, in bronvolgorde. */
export function formatRoadmapEntries(
  entries: readonly RoadmapEntry[],
  maxEntries: number = MAX_ROADMAP_ENTRIES,
): string {
  if (entries.length === 0) {
    return "(de roadmap kon niet worden gelezen — ga er niet van uit dat je weet wat er af is)";
  }

  const shown = entries.slice(0, maxEntries);
  const lines: string[] = [];
  let currentSection: string | null = null;

  for (const entry of shown) {
    if (entry.section !== currentSection) {
      lines.push(`${entry.section}:`);
      currentSection = entry.section;
    }

    lines.push(`- ${entry.title}`);
  }

  if (entries.length > shown.length) {
    lines.push(`(nog ${entries.length - shown.length} kopjes niet getoond)`);
  }

  return lines.join("\n");
}

export interface MissionStateEntry {
  status: string;
  title: string;
}

/**
 * De missies als leesbare tekst, met vooraan het aantal dat nog loopt.
 *
 * Dat aantal staat er apart bij omdat "zijn er nog openstaande missies?" de
 * vraag is die het vaakst gesteld wordt, en een lijst tellen iets is wat een
 * taalmodel misrekent.
 */
export function formatMissionState(
  missions: readonly MissionStateEntry[],
  maxEntries: number = MAX_MISSION_ENTRIES,
): string {
  if (missions.length === 0) {
    return "Er zijn op dit moment geen missies in Mission Engine V2.";
  }

  const finished = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
  const open = missions.filter((mission) => !finished.has(mission.status));

  const header =
    open.length === 0
      ? `Geen enkele van de ${missions.length} recentste missies staat nog open.`
      : `${open.length} van de ${missions.length} recentste missies staat nog open.`;

  const lines = missions
    .slice(0, maxEntries)
    .map((mission) => `- [${mission.status}] ${mission.title}`);

  if (missions.length > maxEntries) {
    lines.push(`(nog ${missions.length - maxEntries} missies niet getoond)`);
  }

  return [header, ...lines].join("\n");
}

export interface ProjectStateBlockInput {
  roadmapText: string;
  missions: readonly MissionStateEntry[];
  /** Waarom de roadmap ontbreekt, wanneer die niet gelezen kon worden. */
  roadmapUnavailableReason?: string | null;
}

/**
 * Het blok dat vooraan de Director-context komt.
 *
 * De laatste alinea is het belangrijkste deel: zonder die instructie zou de
 * Director dit blok als "nog een stuk context" behandelen en alsnog uit het
 * gesprek putten. Er staat daarom expliciet dat dit blok wint van zijn eigen
 * herinnering, inclusief de reden — hij ziet alleen de laatste twintig
 * berichten en weet niet wat daarvóór of daarbuiten is gebeurd.
 */
export function buildProjectStateBlock({
  roadmapText,
  missions,
  roadmapUnavailableReason = null,
}: ProjectStateBlockInput): string {
  const entries = extractRoadmapEntries(roadmapText);

  const roadmapSection = roadmapUnavailableReason
    ? `(docs/roadmap.md kon niet worden gelezen: ${roadmapUnavailableReason}. Doe geen uitspraken over wat af is of nog moet gebeuren zonder dat bestand eerst op te vragen.)`
    : formatRoadmapEntries(entries);

  return [
    "",
    "ACTUELE PROJECTSTAND (automatisch opgehaald bij dit bericht, niet uit het gesprek):",
    "",
    "Roadmap — de kopjes uit docs/roadmap.md, in volgorde, met per kop onder welk hoofdstuk hij valt:",
    roadmapSection,
    "",
    "Missies in Mission Engine V2, meest recent bijgewerkt eerst:",
    formatMissionState(missions),
    "",
    "Behandel dit blok als de waarheid over de huidige stand van het project. Spreekt het je eigen herinnering uit dit gesprek tegen, dan wint dit blok: je ziet maar een beperkt stuk gespreksgeschiedenis en niet wat daarbuiten is gebeurd.",
    "Noem nooit werk als openstaand wanneer het hierboven onder een afgeronde kop staat, en beweer nooit dat er missies openstaan zonder dat de lijst hierboven dat laat zien.",
    "Heb je meer detail nodig dan een kopje, vraag docs/roadmap.md dan op met <workspace-read> voordat je erover oordeelt.",
  ].join("\n");
}
