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
 * WAAROM DE ROADMAP ALLEEN NIET GENOEG IS
 *
 * De eerste versie van dit blok bevatte alleen de roadmap en de missies, met
 * de instructie "behandel dit blok als de waarheid". Daar zit een fout in die
 * de eigenaar terecht manipulatie noemde: docs/roadmap.md wordt met de hand
 * bijgehouden, en wel door hem samen met een assistent. Stopt dat onderhoud,
 * dan blijft het bestand staan alsof alles klopt, en antwoordt de Director
 * met volle overtuiging "nee, er staat niets meer open" — juist op het moment
 * dat er het meest onopgemerkt blijft liggen. Een blok dat stiller wordt
 * naarmate er minder wordt bijgehouden is erger dan geen blok.
 *
 * Daarom staan er nu drie signalen bij die zichzelf bijwerken, zonder dat
 * iemand iets opschrijft:
 *
 *   - openstaande pull requests op GitHub (werk dat begonnen maar niet
 *     afgemaakt is — een PR die blijft hangen is per definitie een losse
 *     draad, wat de roadmap er ook over zegt);
 *   - kennisitems die op beoordeling wachten in Firestore;
 *   - hoeveel commits er zijn geland sinds docs/roadmap.md voor het laatst is
 *     aangeraakt — het directe antwoord op "loopt de documentatie achter op
 *     de werkelijkheid?".
 *
 * En de instructie onderaan is omgedraaid. Het blok is gezaghebbend over wat
 * het lát zien, maar is uitdrukkelijk GEEN volledige lijst van wat aandacht
 * nodig heeft. "Ik kan het niet vaststellen" is een toegestaan antwoord;
 * "nee, er is niets" op grond van een leeg blok niet.
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

/** Hoeveel openstaande pull requests er maximaal in het blok komen. */
export const MAX_PULL_REQUEST_ENTRIES = 15;

/**
 * Vanaf hoeveel commits sinds de laatste roadmapwijziging het blok expliciet
 * waarschuwt dat de roadmap achterloopt.
 *
 * Tien, omdat een enkele commit na een roadmapupdate normaal is (de code die
 * bij de zojuist beschreven stap hoort), maar tien losse wijzigingen zonder
 * dat er iets is opgeschreven betekent dat het document niet meer meebeweegt.
 * Het getal zelf staat er altijd bij, ook onder deze grens, zodat de Director
 * er ook zonder waarschuwing over kan oordelen.
 */
export const ROADMAP_STALE_COMMIT_THRESHOLD = 10;

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

/** Eén openstaande pull request, teruggebracht tot wat de Director nodig heeft. */
export interface OpenPullRequestEntry {
  number: number;
  title: string;
  /** Wanneer de pull request is aangemaakt, als ISO-tekst. Mag ontbreken. */
  createdAt?: string | null;
}

/**
 * Hoeveel hele dagen `iso` vóór `now` ligt, of null wanneer de tekst geen
 * bruikbare datum is. Bewust hele dagen: uren toevoegen zou de tekst elke
 * chatbeurt laten verschillen zonder dat het iets aan het oordeel verandert.
 */
export function ageInDays(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const days = Math.floor((now.getTime() - then) / 86_400_000);
  return days < 0 ? 0 : days;
}

/**
 * De openstaande pull requests als leesbare tekst.
 *
 * Dit is het belangrijkste zelf-bijwerkende signaal in het blok: een pull
 * request die openstaat is werk dat begonnen en niet afgemaakt is, en dat
 * blijft zichtbaar of iemand de roadmap nu bijhoudt of niet. `null` betekent
 * dat GitHub niet bereikbaar was — dat is iets anders dan "er staat niets
 * open", en de tekst zegt dat verschil ook.
 */
export function formatOpenPullRequests(
  pullRequests: readonly OpenPullRequestEntry[] | null,
  now: Date = new Date(),
  maxEntries: number = MAX_PULL_REQUEST_ENTRIES,
): string {
  if (pullRequests === null) {
    return "(kon niet worden opgehaald bij GitHub — je weet dus NIET of er pull requests openstaan)";
  }

  if (pullRequests.length === 0) {
    return "Er staat op dit moment geen enkele pull request open op GitHub.";
  }

  const lines = pullRequests.slice(0, maxEntries).map((pullRequest) => {
    const days = ageInDays(pullRequest.createdAt, now);
    const age = days === null ? "" : ` (${days} dagen open)`;

    return `- #${pullRequest.number} ${pullRequest.title}${age}`;
  });

  if (pullRequests.length > maxEntries) {
    lines.push(`(nog ${pullRequests.length - maxEntries} pull requests niet getoond)`);
  }

  return [
    `${pullRequests.length} pull request(s) staan open. Dit is onafgemaakt werk, ook wanneer de roadmap er niets over zegt.`,
    ...lines,
  ].join("\n");
}

/**
 * Het aantal kennisitems dat nog op beoordeling wacht.
 *
 * Ook zelf-bijwerkend: deze items ontstaan uit de learning loop en blijven
 * staan tot de eigenaar ze goed- of afkeurt. `null` betekent opnieuw: niet
 * kunnen ophalen, niet "geen".
 */
export function formatPendingKnowledge(pendingCount: number | null): string {
  if (pendingCount === null) {
    return "(kon niet worden opgehaald — je weet dus NIET of er kennisitems op beoordeling wachten)";
  }

  if (pendingCount === 0) {
    return "Er wachten geen kennisitems op beoordeling.";
  }

  return `${pendingCount} kennisitem(s) wachten op beoordeling door de eigenaar.`;
}

/** Hoe ver docs/roadmap.md achterloopt op de rest van de repository. */
export interface RoadmapFreshness {
  /** Wanneer docs/roadmap.md voor het laatst is gewijzigd, als ISO-tekst. */
  lastUpdatedIso: string | null;
  /** Hoeveel commits er sindsdien op de standaardbranch zijn geland. */
  commitsSince: number;
  /** Of die telling tegen de bovengrens aan liep (meer dan honderd). */
  capped: boolean;
}

/**
 * De ouderdom van de roadmap als leesbare tekst.
 *
 * Dit is het antwoord op de vraag die de eigenaar stelde: wat gebeurt er als
 * niemand de roadmap meer bijwerkt? Dan loopt dit getal op, en dan zegt het
 * blok dat met zoveel woorden — in plaats van te doen alsof een oud document
 * de huidige stand beschrijft.
 */
export function formatRoadmapFreshness(
  freshness: RoadmapFreshness | null,
  now: Date = new Date(),
): string {
  if (freshness === null || freshness.lastUpdatedIso === null) {
    return "(onbekend wanneer docs/roadmap.md voor het laatst is bijgewerkt — behandel de index hieronder als mogelijk verouderd)";
  }

  const date = freshness.lastUpdatedIso.slice(0, 10);
  const days = ageInDays(freshness.lastUpdatedIso, now);
  const agePart = days === null ? "" : ` (${days} dagen geleden)`;
  const countPart = freshness.capped
    ? "meer dan 100 commits"
    : `${freshness.commitsSince} commit(s)`;

  const base = `docs/roadmap.md is voor het laatst bijgewerkt op ${date}${agePart}; sindsdien zijn er ${countPart} geland.`;

  if (freshness.capped || freshness.commitsSince >= ROADMAP_STALE_COMMIT_THRESHOLD) {
    return `${base} De roadmap loopt dus achter op de code: er is werk gedaan dat hieronder NIET beschreven staat. Zeg dat er expliciet bij voordat je iets over de stand van het project concludeert.`;
  }

  return base;
}

export interface ProjectStateBlockInput {
  roadmapText: string;
  missions: readonly MissionStateEntry[];
  /** Waarom de roadmap ontbreekt, wanneer die niet gelezen kon worden. */
  roadmapUnavailableReason?: string | null;
  /** Openstaande pull requests, of null wanneer GitHub niet bereikbaar was. */
  openPullRequests?: readonly OpenPullRequestEntry[] | null;
  /** Aantal kennisitems op "pending", of null wanneer dat niet lukte. */
  pendingKnowledgeCount?: number | null;
  /** Ouderdom van de roadmap, of null wanneer dat niet vast te stellen was. */
  roadmapFreshness?: RoadmapFreshness | null;
  /** Alleen om de tekst in tests voorspelbaar te maken. */
  now?: Date;
}

/**
 * Het blok dat vooraan de Director-context komt.
 *
 * De instructies onderaan zijn het belangrijkste deel, en ze zeggen twee
 * dingen die allebei nodig zijn:
 *
 * 1. Dit blok wint van zijn eigen herinnering. Zonder die regel behandelt hij
 *    het als "nog een stuk context" en put hij alsnog uit het gesprek, waarvan
 *    hij maar twintig berichten ziet.
 *
 * 2. Dit blok is geen volledige lijst van wat aandacht nodig heeft. Zonder
 *    díe regel wordt punt 1 gevaarlijk: dan leidt een leeg blok tot een
 *    stellige "nee, er is niets", terwijl "leeg" ook kan betekenen dat er
 *    niemand meer bijhoudt. Onzekerheid uitspreken is hier het juiste
 *    antwoord, niet het slechtste.
 */
export function buildProjectStateBlock({
  roadmapText,
  missions,
  roadmapUnavailableReason = null,
  openPullRequests = null,
  pendingKnowledgeCount = null,
  roadmapFreshness = null,
  now = new Date(),
}: ProjectStateBlockInput): string {
  const entries = extractRoadmapEntries(roadmapText);

  const roadmapSection = roadmapUnavailableReason
    ? `(docs/roadmap.md kon niet worden gelezen: ${roadmapUnavailableReason}. Doe geen uitspraken over wat af is of nog moet gebeuren zonder dat bestand eerst op te vragen.)`
    : formatRoadmapEntries(entries);

  return [
    "",
    "ACTUELE PROJECTSTAND (automatisch opgehaald bij dit bericht, niet uit het gesprek):",
    "",
    "Ouderdom van de roadmap:",
    formatRoadmapFreshness(roadmapFreshness, now),
    "",
    "Roadmap — de kopjes uit docs/roadmap.md, in volgorde, met per kop onder welk hoofdstuk hij valt:",
    roadmapSection,
    "",
    "Missies in Mission Engine V2, meest recent bijgewerkt eerst:",
    formatMissionState(missions),
    "",
    "Openstaande pull requests op GitHub:",
    formatOpenPullRequests(openPullRequests, now),
    "",
    "Kennisitems die op beoordeling wachten:",
    formatPendingKnowledge(pendingKnowledgeCount),
    "",
    "HOE JE DIT BLOK GEBRUIKT:",
    "1. Alles hierboven is opgehaald op het moment van dit bericht. Spreekt het je eigen herinnering uit dit gesprek tegen, dan wint dit blok: je ziet maar een beperkt stuk gespreksgeschiedenis en niet wat daarbuiten is gebeurd. Noem nooit werk als openstaand wanneer het hierboven onder een afgeronde kop staat.",
    "2. Dit is GEEN volledige lijst van alles wat aandacht nodig heeft. De roadmap wordt met de hand bijgehouden en kan stilstaan terwijl het werk doorloopt; de missies, pull requests en kennisitems werken zichzelf bij maar dekken lang niet alles.",
    "3. Concludeer daarom NOOIT dat er niets aandacht nodig heeft alleen omdat dit blok leeg oogt. Kun je het niet vaststellen, zeg dan dat je het niet kunt vaststellen en wat je zou moeten bekijken om het wél te weten. Een eerlijk 'dat weet ik niet' is hier beter dan een geruststelling.",
    "4. Loopt de roadmap achter op de code, of kon een onderdeel hierboven niet worden opgehaald, noem dat dan als eerste — vóór je conclusie, niet als voetnoot erna.",
    "5. Heb je meer detail nodig dan een kopje, vraag docs/roadmap.md dan op met <workspace-read> voordat je erover oordeelt.",
  ].join("\n");
}
