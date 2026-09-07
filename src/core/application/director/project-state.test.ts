import { describe, expect, it } from "vitest";

import {
  ROADMAP_STALE_COMMIT_THRESHOLD,
  ageInDays,
  buildProjectStateBlock,
  extractRoadmapEntries,
  formatMissionState,
  formatOpenPullRequests,
  formatPendingKnowledge,
  formatRoadmapEntries,
  formatRoadmapFreshness,
} from "./project-state";

const ROADMAP = [
  "# The Dost Matrix — Roadmap",
  "",
  "## Voltooid",
  "",
  "### Stap 1 — Second Brain learning loop",
  "Wat tekst.",
  "",
  "### Stap 10 — Bewijslaag voor de Builder",
  "Meer tekst.",
  "",
  "## Voorgestelde volgende stappen",
  "",
  "### Stap 13 — The Dost Council V1",
  "Nog te doen.",
].join("\n");

/** Vast "nu", zodat elke ouderdom in deze tests exact uitrekenbaar is. */
const NOW = new Date("2026-09-07T12:00:00.000Z");

describe("extractRoadmapEntries", () => {
  it("koppelt elk kopje aan het hoofdstuk waar het onder valt", () => {
    expect(extractRoadmapEntries(ROADMAP)).toEqual([
      { section: "Voltooid", title: "Stap 1 — Second Brain learning loop" },
      { section: "Voltooid", title: "Stap 10 — Bewijslaag voor de Builder" },
      { section: "Voorgestelde volgende stappen", title: "Stap 13 — The Dost Council V1" },
    ]);
  });

  it("negeert kopjes binnen een codeblok", () => {
    const markdown = ["## Voltooid", "", "```", "### Dit is code, geen kop", "```", "", "### Echte kop"].join(
      "\n",
    );

    expect(extractRoadmapEntries(markdown)).toEqual([
      { section: "Voltooid", title: "Echte kop" },
    ]);
  });

  it("geeft een lege lijst bij tekst zonder kopjes", () => {
    expect(extractRoadmapEntries("gewoon wat tekst")).toEqual([]);
  });
});

describe("formatRoadmapEntries", () => {
  it("groepeert per hoofdstuk en houdt de bronvolgorde aan", () => {
    const text = formatRoadmapEntries(extractRoadmapEntries(ROADMAP));

    expect(text).toContain("Voltooid:");
    expect(text).toContain("- Stap 1 — Second Brain learning loop");
    expect(text).toContain("Voorgestelde volgende stappen:");
    expect(text.indexOf("Voltooid:")).toBeLessThan(text.indexOf("Voorgestelde volgende stappen:"));
  });

  it("waarschuwt expliciet wanneer er geen kopjes zijn", () => {
    expect(formatRoadmapEntries([])).toContain("ga er niet van uit");
  });

  it("meldt hoeveel kopjes er niet getoond zijn", () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      section: "Voltooid",
      title: `Stap ${index}`,
    }));

    expect(formatRoadmapEntries(many, 2)).toContain("nog 3 kopjes niet getoond");
  });
});

describe("formatMissionState", () => {
  it("zegt het expliciet wanneer er geen missies zijn", () => {
    expect(formatMissionState([])).toContain("geen missies");
  });

  it("telt zelf hoeveel missies er nog openstaan", () => {
    const text = formatMissionState([
      { status: "COMPLETED", title: "Af" },
      { status: "ACTIVE", title: "Loopt nog" },
      { status: "CANCELLED", title: "Gestopt" },
    ]);

    expect(text).toContain("1 van de 3");
  });

  it("zegt het wanneer er niets meer openstaat", () => {
    const text = formatMissionState([
      { status: "COMPLETED", title: "Af" },
      { status: "FAILED", title: "Mislukt" },
    ]);

    expect(text).toContain("Geen enkele van de 2");
  });

  it("toont status en titel per missie", () => {
    expect(formatMissionState([{ status: "ACTIVE", title: "Tests voor de state machine" }])).toContain(
      "- [ACTIVE] Tests voor de state machine",
    );
  });

  it("meldt hoeveel missies er niet getoond zijn", () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      status: "COMPLETED",
      title: `Missie ${index}`,
    }));

    expect(formatMissionState(many, 2)).toContain("nog 3 missies niet getoond");
  });
});

describe("ageInDays", () => {
  it("rekent hele dagen terug vanaf het meegegeven tijdstip", () => {
    expect(ageInDays("2026-09-04T12:00:00.000Z", NOW)).toBe(3);
  });

  it("rondt naar beneden af, zodat een deel van een dag niet meetelt", () => {
    expect(ageInDays("2026-09-06T23:00:00.000Z", NOW)).toBe(0);
  });

  it("geeft null bij een ontbrekende of onleesbare datum", () => {
    expect(ageInDays(null, NOW)).toBeNull();
    expect(ageInDays(undefined, NOW)).toBeNull();
    expect(ageInDays("geen datum", NOW)).toBeNull();
  });

  it("geeft nooit een negatieve ouderdom terug", () => {
    expect(ageInDays("2026-12-01T00:00:00.000Z", NOW)).toBe(0);
  });
});

describe("formatOpenPullRequests", () => {
  it("maakt onderscheid tussen 'niets open' en 'niet kunnen ophalen'", () => {
    expect(formatOpenPullRequests([], NOW)).toContain("geen enkele pull request open");

    const unavailable = formatOpenPullRequests(null, NOW);
    expect(unavailable).toContain("kon niet worden opgehaald");
    expect(unavailable).toContain("NIET");
  });

  it("noemt nummer, titel en hoe lang de pull request al openstaat", () => {
    const text = formatOpenPullRequests(
      [{ number: 48, title: "Stap 12 — semantische herstellus", createdAt: "2026-09-01T12:00:00.000Z" }],
      NOW,
    );

    expect(text).toContain("- #48 Stap 12 — semantische herstellus (6 dagen open)");
  });

  it("laat de ouderdom weg wanneer de aanmaakdatum ontbreekt", () => {
    const text = formatOpenPullRequests([{ number: 7, title: "Zonder datum" }], NOW);

    expect(text).toContain("- #7 Zonder datum");
    expect(text).not.toContain("dagen open");
  });

  it("zegt erbij dat een openstaande pull request onafgemaakt werk is, los van de roadmap", () => {
    const text = formatOpenPullRequests([{ number: 1, title: "Iets" }], NOW);

    expect(text).toContain("onafgemaakt werk");
    expect(text).toContain("roadmap");
  });

  it("meldt hoeveel pull requests er niet getoond zijn", () => {
    const many = Array.from({ length: 5 }, (_, index) => ({
      number: index,
      title: `PR ${index}`,
    }));

    expect(formatOpenPullRequests(many, NOW, 2)).toContain("nog 3 pull requests niet getoond");
  });
});

describe("formatPendingKnowledge", () => {
  it("maakt onderscheid tussen nul en niet kunnen ophalen", () => {
    expect(formatPendingKnowledge(0)).toContain("geen kennisitems");

    const unavailable = formatPendingKnowledge(null);
    expect(unavailable).toContain("kon niet worden opgehaald");
    expect(unavailable).toContain("NIET");
  });

  it("noemt het aantal wachtende items", () => {
    expect(formatPendingKnowledge(6)).toContain("6 kennisitem");
  });
});

describe("formatRoadmapFreshness", () => {
  it("zegt dat de ouderdom onbekend is wanneer die niet vast te stellen was", () => {
    expect(formatRoadmapFreshness(null, NOW)).toContain("onbekend");
    expect(
      formatRoadmapFreshness({ lastUpdatedIso: null, commitsSince: 0, capped: false }, NOW),
    ).toContain("onbekend");
  });

  it("noemt de datum, de ouderdom in dagen en het aantal commits sindsdien", () => {
    const text = formatRoadmapFreshness(
      { lastUpdatedIso: "2026-09-05T09:00:00.000Z", commitsSince: 2, capped: false },
      NOW,
    );

    expect(text).toContain("2026-09-05");
    expect(text).toContain("2 dagen geleden");
    expect(text).toContain("2 commit(s)");
  });

  it("waarschuwt niet bij een klein aantal commits sinds de laatste update", () => {
    const text = formatRoadmapFreshness(
      { lastUpdatedIso: "2026-09-05T09:00:00.000Z", commitsSince: ROADMAP_STALE_COMMIT_THRESHOLD - 1, capped: false },
      NOW,
    );

    expect(text).not.toContain("loopt dus achter");
  });

  it("waarschuwt zodra de drempel gehaald wordt, en vraagt dat expliciet te melden", () => {
    const text = formatRoadmapFreshness(
      { lastUpdatedIso: "2026-08-01T09:00:00.000Z", commitsSince: ROADMAP_STALE_COMMIT_THRESHOLD, capped: false },
      NOW,
    );

    expect(text).toContain("loopt dus achter op de code");
    expect(text).toContain("NIET beschreven");
  });

  it("waarschuwt ook wanneer de telling tegen de bovengrens aan liep", () => {
    const text = formatRoadmapFreshness(
      { lastUpdatedIso: "2026-01-01T09:00:00.000Z", commitsSince: 99, capped: true },
      NOW,
    );

    expect(text).toContain("meer dan 100 commits");
    expect(text).toContain("loopt dus achter op de code");
  });
});

describe("buildProjectStateBlock", () => {
  it("bevat de roadmapkopjes en de missies", () => {
    const block = buildProjectStateBlock({
      roadmapText: ROADMAP,
      missions: [{ status: "ACTIVE", title: "Loopt nog" }],
      now: NOW,
    });

    expect(block).toContain("Stap 10 — Bewijslaag voor de Builder");
    expect(block).toContain("- [ACTIVE] Loopt nog");
  });

  it("zegt dat dit blok wint van de eigen herinnering", () => {
    const block = buildProjectStateBlock({ roadmapText: ROADMAP, missions: [], now: NOW });

    expect(block).toContain("dan wint dit blok");
    expect(block).toContain("Noem nooit werk als openstaand");
  });

  it("zegt expliciet wanneer de roadmap niet gelezen kon worden, met de reden", () => {
    const block = buildProjectStateBlock({
      roadmapText: "",
      missions: [],
      roadmapUnavailableReason: "Bestand is te groot om veilig te lezen.",
      now: NOW,
    });

    expect(block).toContain("kon niet worden gelezen");
    expect(block).toContain("te groot om veilig te lezen");
    expect(block).toContain("Doe geen uitspraken");
  });

  it("neemt de drie zelf-bijwerkende signalen op", () => {
    const block = buildProjectStateBlock({
      roadmapText: ROADMAP,
      missions: [],
      openPullRequests: [{ number: 48, title: "Nog open", createdAt: "2026-09-01T12:00:00.000Z" }],
      pendingKnowledgeCount: 6,
      roadmapFreshness: { lastUpdatedIso: "2026-09-05T09:00:00.000Z", commitsSince: 2, capped: false },
      now: NOW,
    });

    expect(block).toContain("- #48 Nog open (6 dagen open)");
    expect(block).toContain("6 kennisitem");
    expect(block).toContain("2026-09-05");
  });

  it("verbiedt de conclusie 'er is niets' op grond van een leeg blok", () => {
    // Dit is de kern van de kritiek waar deze uitbreiding uit voortkomt: een
    // blok dat leeg oogt omdat er niemand meer bijhoudt, mag geen
    // geruststelling worden. Alles staat hier op nul en tóch moet het blok
    // zeggen dat "niets aandacht nodig" geen toegestane conclusie is.
    const block = buildProjectStateBlock({
      roadmapText: ROADMAP,
      missions: [],
      openPullRequests: [],
      pendingKnowledgeCount: 0,
      roadmapFreshness: { lastUpdatedIso: "2026-09-05T09:00:00.000Z", commitsSince: 0, capped: false },
      now: NOW,
    });

    expect(block).toContain("GEEN volledige lijst");
    expect(block).toContain("NOOIT dat er niets aandacht nodig heeft");
    expect(block).toContain("weet ik niet");
  });

  it("laat een niet-opgehaald onderdeel als onbekend zien, niet als leeg", () => {
    const block = buildProjectStateBlock({
      roadmapText: ROADMAP,
      missions: [],
      openPullRequests: null,
      pendingKnowledgeCount: null,
      roadmapFreshness: null,
      now: NOW,
    });

    expect(block).toContain("je weet dus NIET of er pull requests openstaan");
    expect(block).toContain("je weet dus NIET of er kennisitems op beoordeling wachten");
    expect(block).toContain("onbekend wanneer docs/roadmap.md");
    expect(block).toContain("noem dat dan als eerste");
  });
});
