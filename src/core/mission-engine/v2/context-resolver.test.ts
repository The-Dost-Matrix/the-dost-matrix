import { describe, expect, it } from "vitest";

import {
  buildContextManifest,
  directoryOf,
  extractImportSpecifiers,
  findExampleTestFile,
  findModuleUnderTest,
  moduleUnderTestCandidates,
  normalizeRepoPath,
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
