import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";
import {
  findRelevantKnowledge,
  hasKeywordMatch,
} from "@/core/application/knowledge/relevance";

/**
 * Stap 20 — het filter- en zoekwerk achter de Second Brain-pagina.
 *
 * WAAROM DE ZOEKOPDRACHT NIET ZELF IETS BEDENKT
 *
 * Er wordt hier geen eigen zoekalgoritme geschreven. De rangschikking loopt
 * via `findRelevantKnowledge` uit relevance.ts — exact dezelfde regels waarmee
 * de Director bepaalt welke kennis hij bij een missie betrekt. Dat is de hele
 * reden dat die berekening op 18 september uit retrieval.ts is gehaald: een
 * scherm dat andere kennis "relevant" noemt dan het systeem zelf gebruikt,
 * liegt zonder dat iemand het merkt.
 *
 * Alles hieronder is pure rekenkunde: kennisitems in, kennisitems uit. Geen
 * netwerk, geen database, geen React — zo is het met gewone tests te dekken.
 */

export type KnowledgePeriod = "all" | "week" | "month" | "quarter";

export const PERIOD_DAYS: Record<Exclude<KnowledgePeriod, "all">, number> = {
  week: 7,
  month: 31,
  quarter: 92,
};

export interface KnowledgeFilters {
  /** Vrije zoekterm. Leeg betekent: niet rangschikken, gewoon nieuwste eerst. */
  query: string;
  /** Lege lijst betekent altijd "alles" — nooit "niets". */
  types: string[];
  sources: string[];
  tags: string[];
  period: KnowledgePeriod;
}

export const EMPTY_FILTERS: KnowledgeFilters = {
  query: "",
  types: [],
  sources: [],
  tags: [],
  period: "all",
};

/**
 * Waar een kennisitem vandaan komt, in één regel die Elroy herkent.
 *
 * De bestandsnaam gaat voor: "proef-kosten.xlsx" zegt hem meer dan
 * "document". Pas als die ontbreekt valt dit terug op de soort bron. Dit is
 * precies waar de roadmap op doelt met "terugvindbaar zonder dat je weet welke
 * missie 'm oorspronkelijk voorstelde" — je zoekt op wat je je herinnert, en
 * dat is bijna altijd het document.
 */
export function entrySourceLabel(entry: KnowledgeEntry): string {
  const fromReference = entry.sourceReferences.find((reference) => reference.filename)?.filename;

  if (fromReference) return fromReference;
  if (entry.sourceDocument?.trim()) return entry.sourceDocument.trim();

  switch (entry.source) {
    case "chat":
      return "Gesprek met de Director";
    case "mission":
      return "Uit een missie";
    case "document":
      return "Uit een document";
    case "youtube":
      return "YouTube";
    case "manual":
      return "Handmatig toegevoegd";
    default:
      return "Onbekende herkomst";
  }
}

export interface FacetOption {
  value: string;
  count: number;
}

export interface KnowledgeFacets {
  types: FacetOption[];
  sources: FacetOption[];
  tags: FacetOption[];
}

function tally(values: string[]): FacetOption[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    // Meest voorkomend bovenaan, en bij gelijke aantallen alfabetisch — anders
    // verspringt de volgorde van de knoppen bij elke nieuwe kennisitem.
    .sort((first, second) => second.count - first.count || first.value.localeCompare(second.value));
}

/**
 * Welke keuzes er te maken vallen, afgeleid uit de kennis die er werkelijk
 * is. Bewust geen vaste lijst van alle mogelijke types: een filterknop voor
 * een soort kennis die je niet hebt, is een knop die altijd niets oplevert.
 *
 * Er wordt hier niets afgekapt. De eerste versie hield de onderwerpen op
 * dertig, en dat is precies de verkeerde plek om te snoeien: bij 754
 * kennisitems was het onderwerp dat jij zocht dan gewoon onvindbaar, zonder
 * dat het scherm liet merken dat er meer was. Het inkorten hoort in de
 * weergave thuis, waar het zichtbaar gebeurt en uit te klappen valt.
 */
export function collectFacets(entries: KnowledgeEntry[]): KnowledgeFacets {
  return {
    types: tally(entries.map((entry) => entry.type ?? "fact")),
    sources: tally(entries.map(entrySourceLabel)),
    tags: tally(entries.flatMap((entry) => entry.tags)),
  };
}

export function isWithinPeriod(
  entry: KnowledgeEntry,
  period: KnowledgePeriod,
  now: Date,
): boolean {
  if (period === "all") return true;

  // Een kennisitem zonder datum wegfilteren zou het onvindbaar maken zodra er
  // ook maar één periodefilter aanstaat. Bij twijfel tonen, niet verbergen.
  if (!entry.createdAt) return true;

  const days = PERIOD_DAYS[period];

  return now.getTime() - entry.createdAt.getTime() <= days * 24 * 60 * 60 * 1000;
}

function matchesAny(selected: string[], values: string[]): boolean {
  if (selected.length === 0) return true;

  return values.some((value) => selected.includes(value));
}

export function applyFilters(
  entries: KnowledgeEntry[],
  filters: KnowledgeFilters,
  now: Date = new Date(),
): KnowledgeEntry[] {
  const filtered = entries.filter(
    (entry) =>
      matchesAny(filters.types, [entry.type ?? "fact"]) &&
      matchesAny(filters.sources, [entrySourceLabel(entry)]) &&
      matchesAny(filters.tags, entry.tags) &&
      isWithinPeriod(entry, filters.period, now),
  );

  const query = filters.query.trim();

  if (!query) return filtered;

  // Twee dingen wijken hier bewust af van hoe de Director dezelfde functie
  // gebruikt.
  //
  // De topK staat op de volledige lengte: de standaard van 12 hoort bij het
  // vullen van een prompt, niet bij een scherm waarop je zelf zoekt en de rest
  // dan onzichtbaar zou blijven.
  //
  // En er komt een extra eis bij: het kennisitem moet ook werkelijk iets met
  // de zoekvraag te maken hebben. Zonder die eis levert een zoekterm die
  // nergens voorkomt tóch beslissingen en architectuuritems op — die halen de
  // drempel op hun type-opslag alleen. Zie hasKeywordMatch in relevance.ts
  // voor waarom dat voor de Director juist goed gedrag is.
  return findRelevantKnowledge(query, null, filtered, filtered.length || 1).filter((entry) =>
    hasKeywordMatch(query, entry),
  );
}
