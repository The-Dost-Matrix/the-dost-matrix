import { describe, expect, it } from "vitest";

import {
  BUILDER_TOOL_DEFINITIONS,
  MAX_TOOL_FILE_CHARS,
  createBuilderToolRunner,
  normalizeToolPath,
  searchTreePaths,
} from "./builder-tools";

/**
 * Tests bij stap 18 (deel 4).
 *
 * Twee dingen staan hier centraal, en geen van beide is "het gereedschap
 * werkt". Het eerste is dat er ALTIJD een leesbaar antwoord teruggaat, ook bij
 * een verkeerd pad of een onbekend gereedschap — gooit dit een uitzondering,
 * dan valt de hele toewijzing om een vraag die verkeerd gesteld was. Het
 * tweede is dat er niets buiten de repository bereikbaar is.
 */

const TREE = [
  "src/core/mission-engine/v2/autonomous-advance.ts",
  "src/core/mission-engine/v2/mission.ts",
  "src/domains/missions/mission-labels.ts",
  "src/domains/missions/mission-labels.test.ts",
];

const CONTENT: Record<string, string> = {
  "src/core/mission-engine/v2/autonomous-advance.ts":
    "export interface MissionAdvanceOutcome { stepsTaken: number; }",
  "src/core/mission-engine/v2/mission.ts": "x".repeat(MAX_TOOL_FILE_CHARS + 500),
};

function runner(overrides: Partial<Parameters<typeof createBuilderToolRunner>[0]> = {}) {
  return createBuilderToolRunner({
    treePaths: TREE,
    readFile: async (path) => CONTENT[path] ?? null,
    ...overrides,
  });
}

const call = (name: string, args: Record<string, unknown>) => ({ id: "t1", name, arguments: args });

describe("normalizeToolPath", () => {
  it("laat een gewoon pad met rust", () => {
    expect(normalizeToolPath("src/a.ts")).toBe("src/a.ts");
  });

  it("vertaalt het @/-alias naar src/", () => {
    // Zo staat het in tsconfig.json, en zo kopieert een model het uit een
    // importregel.
    expect(normalizeToolPath("@/core/a.ts")).toBe("src/core/a.ts");
  });

  it("haalt voorloopstrepen en ./ weg", () => {
    expect(normalizeToolPath("/src/a.ts")).toBe("src/a.ts");
    expect(normalizeToolPath("./src/a.ts")).toBe("src/a.ts");
  });
});

describe("searchTreePaths", () => {
  it("vindt paden op een stuk tekst", () => {
    expect(searchTreePaths(TREE, "mission-labels")).toEqual([
      "src/domains/missions/mission-labels.ts",
      "src/domains/missions/mission-labels.test.ts",
    ]);
  });

  it("let niet op hoofdletters", () => {
    expect(searchTreePaths(TREE, "MISSION-LABELS")).toHaveLength(2);
  });

  it("zet kortere paden vooraan", () => {
    // Die liggen dichter bij de hoofdmap en zijn vaker het bestand dat
    // bedoeld wordt dan een diep weggestopte naamgenoot.
    expect(searchTreePaths(TREE, "mission-labels")[0]).toBe(
      "src/domains/missions/mission-labels.ts",
    );
  });

  it("geeft niets terug bij een leeg patroon", () => {
    expect(searchTreePaths(TREE, "   ")).toEqual([]);
  });

  it("houdt zich aan de bovengrens", () => {
    expect(searchTreePaths(TREE, "src", 2)).toHaveLength(2);
  });
});

describe("createBuilderToolRunner", () => {
  it("geeft de inhoud van een bestaand bestand", async () => {
    const result = await runner()(
      call("lees_bestand", { pad: "src/core/mission-engine/v2/autonomous-advance.ts" }),
    );

    expect(result).toContain("MissionAdvanceOutcome");
  });

  it("accepteert het @/-alias", async () => {
    const result = await runner()(
      call("lees_bestand", { pad: "@/core/mission-engine/v2/autonomous-advance.ts" }),
    );

    expect(result).toContain("MissionAdvanceOutcome");
  });

  it("kapt een groot bestand af en zegt dat erbij", async () => {
    // Zwijgend afkappen is precies de fout die met globals.css is gemaakt:
    // het model denkt dan dat het alles ziet.
    const result = await runner()(
      call("lees_bestand", { pad: "src/core/mission-engine/v2/mission.ts" }),
    );

    expect(result).toContain("eerste");
    expect(result.length).toBeLessThan(MAX_TOOL_FILE_CHARS + 500);
  });

  /**
   * De belangrijkste groep: alles wat misgaat komt terug als tekst, nooit als
   * uitzondering. Anders kost één verkeerd getypt pad een hele ronde.
   */
  it("legt uit dat een pad niet bestaat, met suggesties", async () => {
    const result = await runner()(
      call("lees_bestand", { pad: "src/domains/missions/mission-label.ts" }),
    );

    expect(result).toContain("bestaat niet");
    expect(result).toContain("mission-labels.ts");
  });

  it("weigert een bestand dat de toewijzing zelf schrijft", async () => {
    // De huidige inhoud daarvan staat al in de opdracht; hem hier nóg eens
    // ophalen levert verwarring op over welke versie de echte is.
    const result = await runner({
      writablePaths: ["src/domains/missions/mission-labels.ts"],
    })(call("lees_bestand", { pad: "src/domains/missions/mission-labels.ts" }));

    expect(result).toContain("zelf schrijft");
  });

  it("vraagt om een pad wanneer dat ontbreekt", async () => {
    expect(await runner()(call("lees_bestand", {}))).toContain('"pad"');
  });

  it("zegt het wanneer de inhoud niet opgehaald kon worden, zonder te laten gokken", async () => {
    const result = await runner({ readFile: async () => null })(
      call("lees_bestand", { pad: "src/core/mission-engine/v2/mission.ts" }),
    );

    expect(result).toContain("verzin de inhoud niet");
  });

  it("meldt een onbekend gereedschap met de namen die wél bestaan", async () => {
    const result = await runner()(call("verwijder_alles", { pad: "x" }));

    expect(result).toContain("bestaat niet");
    expect(result).toContain("lees_bestand");
  });

  it("houdt bij wat er gebruikt is", async () => {
    // Zonder logboek is niet te zien of de Builder zijn gereedschap gebruikt,
    // en of hij er iets aan heeft.
    const uses: string[] = [];

    await runner({ onUse: (tool, argument, outcome) => uses.push(`${tool}:${outcome}`) })(
      call("zoek_bestanden", { patroon: "mission-labels" }),
    );

    expect(uses).toEqual(["zoek_bestanden:2_GEVONDEN"]);
  });
});

describe("BUILDER_TOOL_DEFINITIONS", () => {
  it("biedt uitsluitend lezen en zoeken", () => {
    // Geen schrijf- of uitvoergereedschap: schrijven loopt via het vaste pad
    // met de controles van deel 2 en 3 eromheen, en uitvoeren doet de CI.
    expect(BUILDER_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "lees_bestand",
      "zoek_bestanden",
    ]);
  });

  it("beschrijft bij elk gereedschap wanneer je het gebruikt", () => {
    // Dat is de enige sturing op de vraag of het model gereedschap pakt of
    // gaat gokken.
    for (const tool of BUILDER_TOOL_DEFINITIONS) {
      expect(tool.description).toContain("Gebruik dit");
      expect(tool.parameters).toHaveProperty("properties");
    }
  });
});
