import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Alleen getFileContent wordt vervangen; de rest van de GitHub-module blijft
 * de echte — zelfde patroon als in builder-runtime.context.test.ts.
 */
vi.mock("./github/github-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github/github-client")>();
  return {
    ...actual,
    getFileContent: vi.fn(),
  };
});

import { getFileContent } from "./github/github-client";

import {
  describeCiOutcomeForPrompt,
  fetchReferenceEvidence,
  formatReferenceEvidenceForPrompt,
} from "./qa-runtime";

const TARGET = { owner: "The-Dost-Matrix", repo: "the-dost-matrix" };
const REF = "abc123";

const DIRECTORY = "src/core/application/conversation";
const MODULE_PATH = `${DIRECTORY}/chunk-service.ts`;
const TEST_PATH = `${DIRECTORY}/chunk-service.test.ts`;
const HELPER_PATH = `${DIRECTORY}/tekst-hulp.ts`;

const TREE = [MODULE_PATH, TEST_PATH, HELPER_PATH, "src/core/llm/model-router.ts"];

function importLine(clause: string, specifier: string): string {
  return ["import", clause, "from", `"${specifier}";`].join(" ");
}

const MODULE_SOURCE = [
  importLine("{ normaliseer }", "./tekst-hulp"),
  "",
  "export const CHUNK_LENGTH = 6000;",
  "export function splitConversationIntoChunks(content: string): string[] { return [content]; }",
].join("\n");

const CONTENT_BY_PATH: Record<string, string | undefined> = {
  [MODULE_PATH]: MODULE_SOURCE,
  [HELPER_PATH]: "export function normaliseer(x: string): string { return x.trim(); }",
};

beforeEach(() => {
  vi.mocked(getFileContent).mockReset();
  vi.mocked(getFileContent).mockImplementation(async (_target, filePath) => {
    const content = CONTENT_BY_PATH[filePath];
    return content === undefined ? null : { content, sha: `sha-${filePath}` };
  });
});

describe("fetchReferenceEvidence", () => {
  it("stuurt de module onder test mee wanneer de pull request alleen het testbestand wijzigt", async () => {
    const selection = await fetchReferenceEvidence(TARGET, REF, [TEST_PATH], TREE);

    const paths = selection.included.map((file) => file.path);

    expect(paths).toContain(MODULE_PATH);
    expect(selection.included.find((file) => file.path === MODULE_PATH)?.content).toContain(
      "CHUNK_LENGTH",
    );
  });

  it("stuurt ook de directe imports van die module mee", async () => {
    const selection = await fetchReferenceEvidence(TARGET, REF, [TEST_PATH], TREE);

    expect(selection.included.map((file) => file.path)).toContain(HELPER_PATH);
  });

  it("stuurt niets mee wanneer de module al in de pull request zit", async () => {
    const selection = await fetchReferenceEvidence(TARGET, REF, [TEST_PATH, MODULE_PATH], TREE);

    expect(selection.included.map((file) => file.path)).not.toContain(MODULE_PATH);
  });

  it("stuurt niets mee bij een pull request zonder testbestanden", async () => {
    const selection = await fetchReferenceEvidence(TARGET, REF, [MODULE_PATH], TREE);

    expect(selection.included).toHaveLength(0);
    expect(getFileContent).not.toHaveBeenCalled();
  });

  it("neemt hetzelfde bestand niet twee keer op", async () => {
    const selection = await fetchReferenceEvidence(
      TARGET,
      REF,
      [TEST_PATH, `${DIRECTORY}/chunk-service.spec.ts`],
      [...TREE, `${DIRECTORY}/chunk-service.spec.ts`],
    );

    const paths = selection.included.map((file) => file.path);

    expect(paths.filter((path) => path === MODULE_PATH)).toHaveLength(1);
  });
});

describe("formatReferenceEvidenceForPrompt", () => {
  it("geeft een lege tekst wanneer er geen referentiebestanden zijn", () => {
    expect(formatReferenceEvidenceForPrompt({ included: [], omitted: [] })).toBe("");
  });

  it("zegt expliciet dat deze bestanden niet in de pull request zitten", () => {
    const text = formatReferenceEvidenceForPrompt({
      included: [{ path: MODULE_PATH, content: MODULE_SOURCE }],
      omitted: [],
    });

    expect(text).toContain("NIET in de pull request");
    expect(text).toContain("Beoordeel deze bestanden niet zelf");
    expect(text).toContain("CHUNK_LENGTH");
  });

  it("noemt wat er niet is meegestuurd en waarom", () => {
    const text = formatReferenceEvidenceForPrompt({
      included: [],
      omitted: [{ path: "src/groot.ts", reason: "niet meegestuurd: te groot" }],
    });

    expect(text).toContain("NIET meegestuurd");
    expect(text).toContain("src/groot.ts");
    expect(text).toContain("te groot");
  });
});

describe("describeCiOutcomeForPrompt", () => {
  it("noemt een geslaagde CI als bruikbaar bewijs", () => {
    const text = describeCiOutcomeForPrompt({
      state: "success",
      failingCheckNames: [],
      pendingCheckNames: [],
    });

    expect(text).toContain("GESLAAGD");
    expect(text).toContain("gebruik dit dan als bewijs");
  });

  it("noemt de gefaalde controles bij een mislukte CI", () => {
    const text = describeCiOutcomeForPrompt({
      state: "failure",
      failingCheckNames: ["CI / Typecheck & import-check"],
      pendingCheckNames: [],
    });

    expect(text).toContain("MISLUKT");
    expect(text).toContain("CI / Typecheck & import-check");
  });

  it("zegt bij afwezige controles dat er niets uit af te leiden valt", () => {
    const text = describeCiOutcomeForPrompt({
      state: "none",
      failingCheckNames: [],
      pendingCheckNames: [],
    });

    expect(text).toContain("in geen van beide richtingen");
  });
});
