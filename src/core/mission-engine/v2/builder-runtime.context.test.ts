import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Alleen getFileContent wordt vervangen; de rest van de GitHub-module blijft
 * de echte (importOriginal), zodat foutklassen en types dezelfde blijven —
 * zelfde reden als in builder-runtime.mission-branch.test.ts.
 */
vi.mock("./github/github-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github/github-client")>();
  return {
    ...actual,
    getFileContent: vi.fn(),
  };
});

import { getFileContent } from "./github/github-client";

import { resolveTestContext } from "./builder-runtime";
import { BuilderContextError } from "./context-resolver";

const TARGET = { owner: "The-Dost-Matrix", repo: "the-dost-matrix" };
const REF = "director/mission-abc12345-work";

const DIRECTORY = "src/core/mission-engine/v2";

const MODULE_PATH = `${DIRECTORY}/betaal-service.ts`;
const TEST_PATH = `${DIRECTORY}/betaal-service.test.ts`;
const HELPER_PATH = `${DIRECTORY}/bedragen.ts`;
const NEIGHBOUR_TEST_PATH = `${DIRECTORY}/bedragen.test.ts`;

const TREE = [
  MODULE_PATH,
  TEST_PATH,
  HELPER_PATH,
  NEIGHBOUR_TEST_PATH,
  "src/core/llm/model-router.ts",
  "src/components/navigation/sidebar.test.tsx",
];

/**
 * De broncode van de module onder test wordt uit losse stukken opgebouwd in
 * plaats van als letterlijke regel geschreven — anders leest
 * scripts/verify-imports.mjs deze voorbeeldimport als een échte import van
 * dít testbestand. Zie de toelichting in context-resolver.test.ts.
 */
function importLine(clause: string, specifier: string): string {
  return ["import", clause, "from", `"${specifier}";`].join(" ");
}

const MODULE_SOURCE = [
  importLine("{ rondAf }", "./bedragen"),
  importLine("{ getChatProvider }", "@/core/llm/model-router"),
  importLine("{ randomUUID }", "node:crypto"),
  "",
  "export function berekenTotaal(bedragen: number[]): number {",
  "  return bedragen.reduce((som, bedrag) => som + rondAf(bedrag), 0);",
  "}",
].join("\n");

// Bewust `string | undefined`: bij een pad dat hier niet in staat moet de
// opzoeking `undefined` opleveren, en met alleen `string` zou TypeScript de
// vergelijking daarmee als zinloos afkeuren (TS2367).
const CONTENT_BY_PATH: Record<string, string | undefined> = {
  [MODULE_PATH]: MODULE_SOURCE,
  [HELPER_PATH]: "export function rondAf(bedrag: number): number { return Math.round(bedrag); }",
  ["src/core/llm/model-router.ts"]: "export function getChatProvider() { return null; }",
  [NEIGHBOUR_TEST_PATH]: "// bestaand testbestand als stijlvoorbeeld",
};

beforeEach(() => {
  vi.mocked(getFileContent).mockReset();
  vi.mocked(getFileContent).mockImplementation(async (_target, filePath) => {
    const content = CONTENT_BY_PATH[filePath];
    return content === undefined ? null : { content, sha: `sha-${filePath}` };
  });
});

describe("resolveTestContext", () => {
  it("stuurt de module onder test mee als bewijs, met de directe imports erbij", async () => {
    const context = await resolveTestContext(TARGET, REF, TEST_PATH, [TEST_PATH], TREE, false);

    const paths = context.evidence.included.map((file) => file.path);

    expect(paths[0]).toBe(MODULE_PATH);
    expect(paths).toContain(HELPER_PATH);
    expect(paths).toContain("src/core/llm/model-router.ts");
    expect(context.evidence.omitted).toHaveLength(0);
  });

  it("neemt de echte broncode letterlijk mee, niet alleen het pad", async () => {
    const context = await resolveTestContext(TARGET, REF, TEST_PATH, [TEST_PATH], TREE, false);

    const module = context.evidence.included.find((file) => file.path === MODULE_PATH);

    expect(module?.content).toContain("berekenTotaal");
  });

  it("laat externe pakketten buiten het bewijs", async () => {
    const context = await resolveTestContext(TARGET, REF, TEST_PATH, [TEST_PATH], TREE, false);

    expect(context.evidence.included.map((file) => file.path)).not.toContain("node:crypto");
  });

  it("stopt met INSUFFICIENT_CONTEXT wanneer de module onder test niet bestaat en de toewijzing zelf geen broncode schrijft", async () => {
    const orphanTest = `${DIRECTORY}/bestaat-niet.test.ts`;

    await expect(
      resolveTestContext(TARGET, REF, orphanTest, [orphanTest], TREE, false),
    ).rejects.toBeInstanceOf(BuilderContextError);

    await expect(
      resolveTestContext(TARGET, REF, orphanTest, [orphanTest], TREE, false),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CONTEXT" });
  });

  it("stopt NIET wanneer de toewijzing zelf de broncode schrijft die getest wordt", async () => {
    const newModule = `${DIRECTORY}/nieuw.ts`;
    const newTest = `${DIRECTORY}/nieuw.test.ts`;

    const context = await resolveTestContext(
      TARGET,
      REF,
      newTest,
      [newModule, newTest],
      TREE,
      true,
    );

    // Geen bewijs uit de repository: dat komt hier via siblingFiles binnen,
    // met de zojuist geschreven inhoud in plaats van de oude.
    expect(context.evidence.included).toHaveLength(0);
  });

  it("haalt geen bestand als bewijs op dat deze toewijzing zelf schrijft", async () => {
    const context = await resolveTestContext(
      TARGET,
      REF,
      TEST_PATH,
      [HELPER_PATH, TEST_PATH],
      TREE,
      true,
    );

    expect(context.evidence.included.map((file) => file.path)).not.toContain(HELPER_PATH);
    expect(context.evidence.included.map((file) => file.path)).toContain(MODULE_PATH);
  });

  it("kiest een stijlvoorbeeld uit dezelfde map en nooit een bestand uit de toewijzing", async () => {
    const context = await resolveTestContext(TARGET, REF, TEST_PATH, [TEST_PATH], TREE, false);

    expect(context.exampleTestFile?.path).toBe(NEIGHBOUR_TEST_PATH);
  });

  it("stopt met INSUFFICIENT_CONTEXT wanneer de module wel in de boom staat maar niet op te halen is", async () => {
    vi.mocked(getFileContent).mockImplementation(async (_target, filePath) =>
      filePath === MODULE_PATH ? null : { content: "// leeg", sha: "sha" },
    );

    await expect(
      resolveTestContext(TARGET, REF, TEST_PATH, [TEST_PATH], TREE, false),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CONTEXT" });
  });
});
