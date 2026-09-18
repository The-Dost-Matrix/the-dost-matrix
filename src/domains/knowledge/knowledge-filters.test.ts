import { describe, expect, it } from "vitest";

import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";
import {
  EMPTY_FILTERS,
  applyFilters,
  collectFacets,
  entrySourceLabel,
  isWithinPeriod,
} from "./knowledge-filters";

const NU = new Date("2026-09-18T12:00:00Z");

function dagenGeleden(dagen: number): Date {
  return new Date(NU.getTime() - dagen * 24 * 60 * 60 * 1000);
}

/** Alle verplichte velden van KnowledgeEntry, zoals knowledge-entry.ts ze vraagt. */
function maakItem(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "kennis-1",
    ownerId: "eigenaar-1",
    type: "decision",
    title: "Agents werken via GitHub",
    content:
      "Codewijzigingen door agents lopen via een branch en een pull request, nooit via directe bestandstoegang.",
    source: "document",
    sourceReferences: [{ filename: "proef-beslissingen.docx" }],
    status: "approved",
    tags: ["mission engine", "github"],
    embedding: [],
    createdAt: dagenGeleden(1),
    ...overrides,
  };
}

describe("entrySourceLabel", () => {
  it("noemt de bestandsnaam wanneer die er is", () => {
    expect(entrySourceLabel(maakItem())).toBe("proef-beslissingen.docx");
  });

  it("valt terug op de soort bron wanneer er geen bestandsnaam is", () => {
    expect(
      entrySourceLabel(maakItem({ sourceReferences: [], source: "chat" })),
    ).toBe("Gesprek met de Director");

    expect(
      entrySourceLabel(maakItem({ sourceReferences: [], source: "mission" })),
    ).toBe("Uit een missie");
  });
});

describe("isWithinPeriod", () => {
  it("laat alles door bij periode 'all'", () => {
    expect(isWithinPeriod(maakItem({ createdAt: dagenGeleden(400) }), "all", NU)).toBe(true);
  });

  it("houdt een item buiten de gekozen periode tegen", () => {
    expect(isWithinPeriod(maakItem({ createdAt: dagenGeleden(20) }), "week", NU)).toBe(false);
    expect(isWithinPeriod(maakItem({ createdAt: dagenGeleden(20) }), "month", NU)).toBe(true);
  });

  it("toont een item zonder datum altijd", () => {
    // Anders wordt kennis onvindbaar zodra er ook maar één periodefilter
    // aanstaat — verbergen bij twijfel is precies wat dit project elders
    // bestrijdt.
    expect(isWithinPeriod(maakItem({ createdAt: null }), "week", NU)).toBe(true);
  });
});

describe("collectFacets", () => {
  it("telt per soort, herkomst en onderwerp, meest voorkomend eerst", () => {
    const facetten = collectFacets([
      maakItem({ id: "a", type: "decision", tags: ["github"] }),
      maakItem({ id: "b", type: "decision", tags: ["github", "ci"] }),
      maakItem({ id: "c", type: "risk", tags: [] }),
    ]);

    expect(facetten.types[0]).toEqual({ value: "decision", count: 2 });
    expect(facetten.types).toHaveLength(2);
    expect(facetten.tags[0]).toEqual({ value: "github", count: 2 });
  });

  it("noemt alleen soorten die er werkelijk zijn", () => {
    // Een filterknop voor kennis die je niet hebt, levert altijd niets op.
    const facetten = collectFacets([maakItem({ type: "lesson" })]);

    expect(facetten.types.map((optie) => optie.value)).toEqual(["lesson"]);
  });
});

describe("applyFilters", () => {
  const items = [
    maakItem({ id: "a", type: "decision", tags: ["github"] }),
    maakItem({
      id: "b",
      type: "risk",
      title: "Zonder origineel bestand geen herverwerking",
      content: "Het originele bestand wordt niet bewaard, dus herverwerken vraagt een nieuwe upload.",
      sourceReferences: [{ filename: "proef-architectuur.pdf" }],
      tags: ["documentverwerking"],
      createdAt: dagenGeleden(40),
    }),
  ];

  it("geeft alles terug zonder filters", () => {
    expect(applyFilters(items, EMPTY_FILTERS, NU)).toHaveLength(2);
  });

  it("filtert op soort", () => {
    const resultaat = applyFilters(items, { ...EMPTY_FILTERS, types: ["risk"] }, NU);

    expect(resultaat.map((item) => item.id)).toEqual(["b"]);
  });

  it("filtert op herkomst", () => {
    const resultaat = applyFilters(
      items,
      { ...EMPTY_FILTERS, sources: ["proef-architectuur.pdf"] },
      NU,
    );

    expect(resultaat.map((item) => item.id)).toEqual(["b"]);
  });

  it("filtert op onderwerp", () => {
    const resultaat = applyFilters(items, { ...EMPTY_FILTERS, tags: ["github"] }, NU);

    expect(resultaat.map((item) => item.id)).toEqual(["a"]);
  });

  it("filtert op periode", () => {
    const resultaat = applyFilters(items, { ...EMPTY_FILTERS, period: "week" }, NU);

    expect(resultaat.map((item) => item.id)).toEqual(["a"]);
  });

  it("combineert filters met de zoekterm", () => {
    const resultaat = applyFilters(
      items,
      { ...EMPTY_FILTERS, query: "pull request", types: ["decision"] },
      NU,
    );

    expect(resultaat.map((item) => item.id)).toEqual(["a"]);
  });

  it("zet bij een zoekterm het best passende item bovenaan", () => {
    const resultaat = applyFilters(items, { ...EMPTY_FILTERS, query: "origineel bestand bewaren" }, NU);

    expect(resultaat[0]?.id).toBe("b");
  });

  it("laat een zoekterm die nergens op slaat niets opleveren", () => {
    // hasKeywordMatch doet hier het werk. Zonder die eis zou dit item tóch
    // terugkomen: een beslissing haalt de relevantiedrempel al op haar
    // type-opslag, zonder dat er één woord overeenkomt.
    const resultaat = applyFilters(
      items,
      { ...EMPTY_FILTERS, query: "zeilboot spinnaker grootzeil" },
      NU,
    );

    expect(resultaat).toEqual([]);
  });

  it("neemt een lege lijst zonder te struikelen", () => {
    expect(applyFilters([], { ...EMPTY_FILTERS, query: "wat dan ook" }, NU)).toEqual([]);
  });
});
