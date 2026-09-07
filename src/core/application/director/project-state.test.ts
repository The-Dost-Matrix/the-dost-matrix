import { describe, expect, it } from "vitest";

import {
  buildProjectStateBlock,
  extractRoadmapEntries,
  formatMissionState,
  formatRoadmapEntries,
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

describe("buildProjectStateBlock", () => {
  it("bevat de roadmapkopjes en de missies", () => {
    const block = buildProjectStateBlock({
      roadmapText: ROADMAP,
      missions: [{ status: "ACTIVE", title: "Loopt nog" }],
    });

    expect(block).toContain("Stap 10 — Bewijslaag voor de Builder");
    expect(block).toContain("- [ACTIVE] Loopt nog");
  });

  it("zegt dat dit blok wint van de eigen herinnering", () => {
    const block = buildProjectStateBlock({ roadmapText: ROADMAP, missions: [] });

    expect(block).toContain("dan wint dit blok");
    expect(block).toContain("Noem nooit werk als openstaand");
  });

  it("zegt expliciet wanneer de roadmap niet gelezen kon worden, met de reden", () => {
    const block = buildProjectStateBlock({
      roadmapText: "",
      missions: [],
      roadmapUnavailableReason: "Bestand is te groot om veilig te lezen.",
    });

    expect(block).toContain("kon niet worden gelezen");
    expect(block).toContain("te groot om veilig te lezen");
    expect(block).toContain("Doe geen uitspraken");
  });
});
