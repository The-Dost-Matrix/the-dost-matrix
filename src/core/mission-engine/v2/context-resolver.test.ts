import { describe, expect, it } from "vitest";

import {
  buildContextManifest,
  directoryOf,
  extractImportSpecifiers,
  extractTypeOnlyImportSpecifiers,
  findExampleTestFile,
  findModuleUnderTest,
  isBarrelModule,
  moduleUnderTestCandidates,
  normalizeRepoPath,
  refineEvidenceImports,
  resolveDirectImports,
  resolveImportSpecifier,
  selectEvidenceWithinBudget,
} from "./context-resolver";

/**
 * De boom hieronder is een uitsnede van de échte repository, inclusief het
 * geval waar het telkens op misging: builder-runtime.mission-branch.test.ts
 * hoort bij builder-runtime.ts, terwijl er geen bestand
 * builder-runtime.mission-branch.ts bestaat.
 */
/**
 * De voorbeeldbroncode in deze tests wordt uit losse stukken samengesteld in
 * plaats van als één letterlijke regel geschreven.
 *
 * Reden: scripts/verify-imports.mjs leest élk bestand in src/ op importregels
 * en zou een letterlijke voorbeeldregel hier aanzien voor een échte import
 * van dit testbestand — waarna het pad "./x" als ontbrekend gemeld wordt en
 * de import-controle in CI rood kleurt. Dit is precies het gedrag dat we
 * hier testen, dus het moest sowieso opgeschreven worden.
 */
function importLine(clause: string, specifier: string): string {
  return ["import", clause, "from", `"${specifier}";`].join(" ");
}

function exportLine(clause: string, specifier: string): string {
  return ["export", clause, "from", `"${specifier}";`].join(" ");
}

function sideEffectImportLine(specifier: string): string {
  return ["import", `"${specifier}";`].join(" ");
}

/** Zelfde reden als hierboven: nooit een letterlijke importregel in dit bestand. */
function typeImportLine(clause: string, specifier: string): string {
  return ["import", "type", clause, "from", `"${specifier}";`].join(" ");
}

function typeExportLine(clause: string, specifier: string): string {
  return ["export", "type", clause, "from", `"${specifier}";`].join(" ");
}

const TREE = [
  "src/core/mission-engine/v2/builder-runtime.ts",
  "src/core/mission-engine/v2/builder-runtime.test.ts",
  "src/core/mission-engine/v2/builder-runtime.mission-branch.test.ts",
  "src/core/mission-engine/v2/mission-branch.ts",
  "src/core/mission-engine/v2/mission.ts",
  "src/core/mission-engine/v2/github/github-client.ts",
  "src/core/llm/model-router.ts",
  "src/core/llm/usage-tracker.ts",
  "src/core/contracts/v2/index.ts",
  "src/components/navigation/sidebar.tsx",
  "src/components/navigation/sidebar.test.tsx",
  "src/app/dashboard/page.tsx",
];

describe("normalizeRepoPath", () => {
  it("verwijdert punt-stappen, dubbele strepen en lost .. op", () => {
    expect(normalizeRepoPath("a/./b")).toBe("a/b");
    expect(normalizeRepoPath("a//b")).toBe("a/b");
    expect(normalizeRepoPath("a/b/../c")).toBe("a/c");
    expect(normalizeRepoPath("./a/b")).toBe("a/b");
  });
});

describe("directoryOf", () => {
  it("geeft de map, en een lege tekst voor een bestand in de hoofdmap", () => {
    expect(directoryOf("src/core/x.ts")).toBe("src/core");
    expect(directoryOf("x.ts")).toBe("");
  });
});

describe("moduleUnderTestCandidates", () => {
  it("probeert eerst de volledige naam en daarna telkens een punt-segment minder", () => {
    const candidates = moduleUnderTestCandidates(
      "src/core/mission-engine/v2/builder-runtime.mission-branch.test.ts",
    );

    const specific = candidates.indexOf(
      "src/core/mission-engine/v2/builder-runtime.mission-branch.ts",
    );
    const general = candidates.indexOf("src/core/mission-engine/v2/builder-runtime.ts");

    expect(specific).toBeGreaterThanOrEqual(0);
    expect(general).toBeGreaterThanOrEqual(0);
    expect(specific).toBeLessThan(general);
  });

  it("zet bij een .test.tsx de .tsx-variant vóór de .ts-variant", () => {
    const candidates = moduleUnderTestCandidates("src/components/navigation/sidebar.test.tsx");

    expect(candidates[0]).toBe("src/components/navigation/sidebar.tsx");
    expect(candidates).toContain("src/components/navigation/sidebar.ts");
  });

  it("geeft niets terug voor een pad dat geen testbestand is", () => {
    expect(moduleUnderTestCandidates("src/core/mission-engine/v2/builder-runtime.ts")).toEqual([]);
  });
});

describe("findModuleUnderTest", () => {
  it("vindt de module ook wanneer de testnaam een extra segment bevat", () => {
    expect(
      findModuleUnderTest(
        "src/core/mission-engine/v2/builder-runtime.mission-branch.test.ts",
        TREE,
      ),
    ).toBe("src/core/mission-engine/v2/builder-runtime.ts");
  });

  it("vindt de gewone module bij een gewone testnaam", () => {
    expect(
      findModuleUnderTest("src/core/mission-engine/v2/builder-runtime.test.ts", TREE),
    ).toBe("src/core/mission-engine/v2/builder-runtime.ts");
  });

  it("geeft null wanneer er geen bijbehorende module bestaat", () => {
    expect(findModuleUnderTest("src/core/mission-engine/v2/bestaat-niet.test.ts", TREE)).toBeNull();
  });
});

describe("extractImportSpecifiers", () => {
  it("herkent gewone imports, type-imports, re-exports en losse imports", () => {
    const source = [
      importLine("{ randomUUID }", "node:crypto"),
      importLine("type { RoleResult }", "@/core/contracts/v2"),
      importLine("{ getChatProvider }", "@/core/llm/model-router"),
      importLine("{ MISSION_BRANCH_NAME }", "./mission-branch"),
      exportLine("{ helper }", "../helpers"),
      sideEffectImportLine("./styles.css"),
    ].join("\n");

    expect(extractImportSpecifiers(source)).toEqual([
      "node:crypto",
      "@/core/contracts/v2",
      "@/core/llm/model-router",
      "./mission-branch",
      "../helpers",
      "./styles.css",
    ]);
  });

  it("noemt hetzelfde importpad maar één keer", () => {
    const source = [importLine("{ a }", "./x"), importLine("type { B }", "./x")].join("\n");

    expect(extractImportSpecifiers(source)).toEqual(["./x"]);
  });
});

describe("resolveImportSpecifier", () => {
  const from = "src/core/mission-engine/v2/builder-runtime.ts";

  it("zet @/ om naar src/", () => {
    expect(resolveImportSpecifier(from, "@/core/llm/model-router", TREE)).toBe(
      "src/core/llm/model-router.ts",
    );
  });

  it("lost een relatief pad op ten opzichte van het importerende bestand", () => {
    expect(resolveImportSpecifier(from, "./mission-branch", TREE)).toBe(
      "src/core/mission-engine/v2/mission-branch.ts",
    );
    expect(resolveImportSpecifier(from, "./github/github-client", TREE)).toBe(
      "src/core/mission-engine/v2/github/github-client.ts",
    );
  });

  it("vindt een index-bestand wanneer het pad naar een map wijst", () => {
    expect(resolveImportSpecifier(from, "@/core/contracts/v2", TREE)).toBe(
      "src/core/contracts/v2/index.ts",
    );
  });

  it("geeft null voor een extern pakket", () => {
    expect(resolveImportSpecifier(from, "node:crypto", TREE)).toBeNull();
    expect(resolveImportSpecifier(from, "vitest", TREE)).toBeNull();
  });

  it("geeft null wanneer het pad nergens in de repository bestaat", () => {
    expect(resolveImportSpecifier(from, "./bestaat-niet", TREE)).toBeNull();
  });
});

describe("resolveDirectImports", () => {
  it("geeft de bestaande, interne imports gesorteerd terug en laat de rest weg", () => {
    const source = [
      importLine("{ randomUUID }", "node:crypto"),
      importLine("type { RoleResult }", "@/core/contracts/v2"),
      importLine("{ getChatProvider }", "@/core/llm/model-router"),
      importLine("{ upsertFile }", "./github/github-client"),
      importLine("{ MISSION_BRANCH_NAME }", "./mission-branch"),
      importLine("{ niets }", "./bestaat-niet"),
    ].join("\n");

    expect(
      resolveDirectImports("src/core/mission-engine/v2/builder-runtime.ts", source, TREE),
    ).toEqual([
      "src/core/contracts/v2/index.ts",
      "src/core/llm/model-router.ts",
      "src/core/mission-engine/v2/github/github-client.ts",
      "src/core/mission-engine/v2/mission-branch.ts",
    ]);
  });

  it("neemt het bestand nooit als bewijs van zichzelf op", () => {
    const source = importLine("{ x }", "./builder-runtime");

    expect(
      resolveDirectImports("src/core/mission-engine/v2/builder-runtime.ts", source, TREE),
    ).toEqual([]);
  });
});

describe("findExampleTestFile", () => {
  it("kiest een testbestand uit dezelfde map", () => {
    expect(
      findExampleTestFile("src/core/mission-engine/v2/builder-runtime.mission-branch.test.ts", TREE),
    ).toBe("src/core/mission-engine/v2/builder-runtime.test.ts");
  });

  it("kiest nooit het bestand dat geschreven wordt, of een ander bestand uit de opdracht", () => {
    const chosen = findExampleTestFile(
      "src/core/mission-engine/v2/builder-runtime.mission-branch.test.ts",
      TREE,
      ["src/core/mission-engine/v2/builder-runtime.test.ts"],
    );

    expect(chosen).not.toBe("src/core/mission-engine/v2/builder-runtime.mission-branch.test.ts");
    expect(chosen).not.toBe("src/core/mission-engine/v2/builder-runtime.test.ts");
  });

  it("zoekt een map omhoog wanneer er in de eigen map geen ander testbestand staat", () => {
    expect(findExampleTestFile("src/components/navigation/menu.test.tsx", TREE)).toBe(
      "src/components/navigation/sidebar.test.tsx",
    );

    expect(findExampleTestFile("src/app/dashboard/page.test.tsx", TREE)).toBe(
      "src/components/navigation/sidebar.test.tsx",
    );
  });

  it("geeft null wanneer de repository helemaal geen testbestanden bevat", () => {
    expect(findExampleTestFile("src/x.test.ts", ["src/x.ts", "src/y.ts"])).toBeNull();
  });
});

describe("selectEvidenceWithinBudget", () => {
  it("houdt de volgorde aan en meldt wat er buiten het aantal valt", () => {
    const candidates = [
      { path: "a.ts", content: "a" },
      { path: "b.ts", content: "b" },
      { path: "c.ts", content: "c" },
    ];

    const selection = selectEvidenceWithinBudget(candidates, 2, 1000);

    expect(selection.included.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    expect(selection.omitted).toHaveLength(1);
    expect(selection.omitted[0].path).toBe("c.ts");
    expect(selection.omitted[0].reason).toContain("maximaal 2");
  });

  it("laat een te groot bestand weg maar neemt kleinere daarna nog wel mee", () => {
    const candidates = [
      { path: "klein.ts", content: "12345" },
      { path: "groot.ts", content: "x".repeat(500) },
      { path: "ook-klein.ts", content: "67890" },
    ];

    const selection = selectEvidenceWithinBudget(candidates, 8, 100);

    expect(selection.included.map((file) => file.path)).toEqual(["klein.ts", "ook-klein.ts"]);
    expect(selection.omitted.map((entry) => entry.path)).toEqual(["groot.ts"]);
    expect(selection.omitted[0].reason).toContain("500 tekens");
  });

  it("neemt alles mee wanneer het binnen het budget past", () => {
    const candidates = [{ path: "a.ts", content: "a" }];
    const selection = selectEvidenceWithinBudget(candidates);

    expect(selection.included).toHaveLength(1);
    expect(selection.omitted).toHaveLength(0);
  });
});

describe("buildContextManifest", () => {
  it("noemt schrijfbare bestanden, bewijs, stijlvoorbeeld en wat ontbreekt", () => {
    const manifest = buildContextManifest({
      writablePaths: ["src/core/x.test.ts"],
      evidence: {
        included: [{ path: "src/core/x.ts", content: "..." }],
        omitted: [{ path: "src/core/groot.ts", reason: "niet meegestuurd: te groot" }],
      },
      examplePath: "src/core/y.test.ts",
    });

    expect(manifest).toContain("src/core/x.test.ts");
    expect(manifest).toContain("src/core/x.ts");
    expect(manifest).toContain("src/core/y.test.ts");
    expect(manifest).toContain("src/core/groot.ts");
    expect(manifest).toContain("NIET meegestuurd");
  });

  it("laat de kopjes voor bewijs en ontbrekende bestanden weg wanneer die er niet zijn", () => {
    const manifest = buildContextManifest({
      writablePaths: ["src/core/x.ts"],
      evidence: { included: [], omitted: [] },
    });

    expect(manifest).toContain("src/core/x.ts");
    expect(manifest).not.toContain("NIET meegestuurd");
    expect(manifest).not.toContain("stijlvoorbeeld");
  });
});

/**
 * Stap 18 — doorkijken door doorverwijzingen.
 *
 * De aanleiding is concreet: bij PR #54 lag het type dat je nodig hebt om een
 * mock-signatuur te beoordelen twee stappen verderop, met een bestand ertussen
 * dat zelf niets zei. De één-laag-grens blijft, maar een bestand dat alleen
 * doorverwijst hoort geen plek in de bundel op te eten.
 */
const BARREL_TREE = [
  "src/core/contracts/v2/index.ts",
  "src/core/contracts/v2/role-result.ts",
  "src/core/contracts/v2/mission-decision.ts",
  "src/core/domain/shapes.ts",
  "src/core/domain/primitives.ts",
  "src/core/werk/module.ts",
  "src/core/werk/module.test.ts",
  "src/core/werk/helper.ts",
];

describe("isBarrelModule", () => {
  it("herkent een bestand dat uitsluitend doorverwijst", () => {
    const source = [
      exportLine("{ RoleResult }", "./role-result"),
      exportLine("{ MissionDecision }", "./mission-decision"),
    ].join("\n");

    expect(isBarrelModule(source)).toBe(true);
  });

  it("laat zich niet misleiden door commentaar rondom de doorverwijzingen", () => {
    const source = [
      "/** Verzamelpunt voor de contracten. */",
      exportLine("{ RoleResult }", "./role-result"),
      "// en de rest",
      exportLine("*", "./mission-decision"),
    ].join("\n");

    expect(isBarrelModule(source)).toBe(true);
  });

  it("beschouwt een bestand met eigen code niet als doorverwijzing", () => {
    // Bij twijfel false: liever een nutteloos bestand te veel in de bundel dan
    // een nuttig bestand vervangen door iets anders.
    const source = [
      exportLine("{ RoleResult }", "./role-result"),
      "export function helper() { return 1; }",
    ].join("\n");

    expect(isBarrelModule(source)).toBe(false);
  });

  it("beschouwt een bestand zonder doorverwijzingen niet als barrel", () => {
    expect(isBarrelModule("export const x = 1;")).toBe(false);
    expect(isBarrelModule("")).toBe(false);
  });
});

describe("extractTypeOnlyImportSpecifiers", () => {
  it("vindt alleen de imports die uitsluitend een type binnenhalen", () => {
    const source = [
      importLine("{ iets }", "./gewoon"),
      typeImportLine("{ Vorm }", "./vorm"),
      typeExportLine("{ Andere }", "./andere"),
      sideEffectImportLine("./neveneffect"),
    ].join("\n");

    expect(extractTypeOnlyImportSpecifiers(source)).toEqual(["./vorm", "./andere"]);
  });

  it("geeft een lege lijst wanneer er geen type-imports zijn", () => {
    expect(extractTypeOnlyImportSpecifiers(importLine("{ x }", "./y"))).toEqual([]);
  });
});

describe("refineEvidenceImports", () => {
  it("vervangt een barrel door de bestanden waar hij naar doorverwijst", () => {
    const barrelSource = [
      exportLine("{ RoleResult }", "./role-result"),
      exportLine("{ MissionDecision }", "./mission-decision"),
    ].join("\n");

    const result = refineEvidenceImports({
      modulePath: "src/core/werk/module.ts",
      moduleSource: importLine("{ RoleResult }", "@/core/contracts/v2"),
      directImports: ["src/core/contracts/v2/index.ts"],
      sources: new Map([["src/core/contracts/v2/index.ts", barrelSource]]),
      treePaths: BARREL_TREE,
    });

    expect(result.replacements).toEqual([
      {
        barrelPath: "src/core/contracts/v2/index.ts",
        targets: [
          "src/core/contracts/v2/mission-decision.ts",
          "src/core/contracts/v2/role-result.ts",
        ],
      },
    ]);
  });

  it("laat een gewoon bestand met eigen inhoud staan", () => {
    const result = refineEvidenceImports({
      modulePath: "src/core/werk/module.ts",
      moduleSource: importLine("{ helper }", "./helper"),
      directImports: ["src/core/werk/helper.ts"],
      sources: new Map([["src/core/werk/helper.ts", "export function helper() { return 1; }"]]),
      treePaths: BARREL_TREE,
    });

    expect(result.replacements).toEqual([]);
    expect(result.additional).toEqual([]);
  });

  it("volgt één extra hop via type-imports naar het bestand dat de vorm draagt", () => {
    // Precies het geval van PR #54: de module praat tegen shapes.ts, maar de
    // vorm die je nodig hebt staat in primitives.ts, een stap verderop.
    const result = refineEvidenceImports({
      modulePath: "src/core/werk/module.ts",
      moduleSource: typeImportLine("{ Vorm }", "@/core/domain/shapes"),
      directImports: ["src/core/domain/shapes.ts"],
      sources: new Map([
        ["src/core/domain/shapes.ts", typeImportLine("{ Basis }", "./primitives")],
      ]),
      treePaths: BARREL_TREE,
    });

    expect(result.additional).toEqual(["src/core/domain/primitives.ts"]);
  });

  it("volgt géén extra hop via een gewone import", () => {
    // De grens blijft één laag. Alleen types dragen de vorm die de Builder
    // nodig heeft; gewone imports zouden de bundel laten groeien zonder dat
    // het bewijs beter wordt.
    const result = refineEvidenceImports({
      modulePath: "src/core/werk/module.ts",
      moduleSource: importLine("{ vorm }", "@/core/domain/shapes"),
      directImports: ["src/core/domain/shapes.ts"],
      sources: new Map([
        ["src/core/domain/shapes.ts", importLine("{ basis }", "./primitives")],
      ]),
      treePaths: BARREL_TREE,
    });

    expect(result.additional).toEqual([]);
  });

  it("begrenst het aantal extra bestanden", () => {
    const result = refineEvidenceImports({
      modulePath: "src/core/werk/module.ts",
      moduleSource: typeImportLine("{ Vorm }", "@/core/domain/shapes"),
      directImports: ["src/core/domain/shapes.ts"],
      sources: new Map([
        [
          "src/core/domain/shapes.ts",
          [
            typeImportLine("{ A }", "./primitives"),
            typeImportLine("{ B }", "@/core/werk/helper"),
          ].join("\n"),
        ],
      ]),
      treePaths: BARREL_TREE,
      maxTypeHopFiles: 1,
    });

    expect(result.additional).toHaveLength(1);
  });

  it("voegt niets toe wat al in de bundel zit", () => {
    const result = refineEvidenceImports({
      modulePath: "src/core/werk/module.ts",
      moduleSource: typeImportLine("{ Vorm }", "@/core/domain/shapes"),
      directImports: ["src/core/domain/shapes.ts", "src/core/domain/primitives.ts"],
      sources: new Map([
        ["src/core/domain/shapes.ts", typeImportLine("{ Basis }", "./primitives")],
        ["src/core/domain/primitives.ts", "export type Basis = string;"],
      ]),
      treePaths: BARREL_TREE,
    });

    expect(result.additional).toEqual([]);
  });

  it("doet niets wanneer de inhoud van een import niet is opgehaald", () => {
    const result = refineEvidenceImports({
      modulePath: "src/core/werk/module.ts",
      moduleSource: importLine("{ RoleResult }", "@/core/contracts/v2"),
      directImports: ["src/core/contracts/v2/index.ts"],
      sources: new Map(),
      treePaths: BARREL_TREE,
    });

    expect(result.replacements).toEqual([]);
    expect(result.additional).toEqual([]);
  });
});

describe("buildContextManifest met doorverwijzingen", () => {
  it("noemt zowel de barrel als het bestand waarnaar hij verwijst", () => {
    // De Builder ziet de inhoud van het doelbestand, maar de rest van de
    // codebase importeert via de barrel. Zonder deze regel zou hij kunnen
    // denken dat het ene pad niet bestaat.
    const manifest = buildContextManifest({
      writablePaths: ["src/core/werk/module.test.ts"],
      evidence: {
        included: [{ path: "src/core/contracts/v2/role-result.ts", content: "x" }],
        omitted: [],
      },
      followedThrough: [
        {
          barrelPath: "src/core/contracts/v2/index.ts",
          targets: ["src/core/contracts/v2/role-result.ts"],
        },
      ],
    });

    expect(manifest).toContain("src/core/contracts/v2/index.ts");
    expect(manifest).toContain("verwijst door naar");
    expect(manifest).toContain("src/core/contracts/v2/role-result.ts");
  });

  it("laat het kopje weg wanneer er niets is doorverwezen", () => {
    const manifest = buildContextManifest({
      writablePaths: ["src/core/werk/module.ts"],
      evidence: { included: [], omitted: [] },
    });

    expect(manifest).not.toContain("verwijst door naar");
  });
});
