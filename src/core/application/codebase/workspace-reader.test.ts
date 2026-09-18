import { describe, expect, it } from "vitest";
import {
  formatWorkspaceReadResults,
  isBlockedWorkspacePath,
  parseWorkspaceReadRequest,
} from "./workspace-reader";

/**
 * Gelezen exports uit workspace-reader.ts:
 * - isBlockedWorkspacePath(relativePath: string), afgeleid retourtype boolean.
 * - parseWorkspaceReadRequest(content: string): string[] | null.
 * - formatWorkspaceReadResults(results: WorkspaceReadResult[]),
 *   afgeleid retourtype string.
 *
 * De pure functies worden rechtstreeks aangeroepen, zonder mocks.
 * Beleidswaarden zijn letterlijk overgenomen uit de gelezen bron.
 *
 * QA-blokkade: deze omgeving biedt alleen leesgereedschap.
 * npm run typecheck en npx vitest run zijn niet uitgevoerd.
 * Er is geen PR geopend en geen Git-diff gecontroleerd.
 */

describe("isBlockedWorkspacePath", () => {
  for (const directory of [
    ".git",
    ".next",
    ".turbo",
    ".vercel",
    "build",
    "coverage",
    "dist",
    "node_modules",
  ]) {
    it(`weigert bestanden in de geblokkeerde map ${directory}`, () => {
      expect(isBlockedWorkspacePath(`src/${directory}/index.ts`)).toBe(true);
    });
  }

  it("weigert .env en varianten met het voorvoegsel .env.", () => {
    expect(isBlockedWorkspacePath(".env")).toBe(true);
    expect(isBlockedWorkspacePath("config/.env.local")).toBe(true);
    expect(isBlockedWorkspacePath("config/.env.production")).toBe(true);
    expect(isBlockedWorkspacePath("config/.env.production.local")).toBe(true);
  });

  for (const extension of [".jks", ".key", ".keystore", ".p12", ".pem", ".pfx"]) {
    it(`weigert de geblokkeerde extensie ${extension}`, () => {
      expect(isBlockedWorkspacePath(`config/certificate${extension}`)).toBe(true);
    });
  }

  for (const namePart of [
    "adminsdk",
    "credential",
    "firebase-admin",
    "private-key",
    "private_key",
    "secret",
    "service-account",
    "service_account",
  ]) {
    it(`weigert een bestandsnaam met ${namePart}`, () => {
      expect(isBlockedWorkspacePath(`config/app-${namePart}.json`)).toBe(true);
    });
  }

  it("weigert de expliciet geblokkeerde SSH-sleutelnamen", () => {
    expect(isBlockedWorkspacePath("config/id_rsa")).toBe(true);
    expect(isBlockedWorkspacePath("config/id_ed25519")).toBe(true);
  });

  it("controleert geblokkeerde paden hoofdletterongevoelig", () => {
    expect(isBlockedWorkspacePath("src/NODE_MODULES/index.ts")).toBe(true);
    expect(isBlockedWorkspacePath("config/.ENV.LOCAL")).toBe(true);
    expect(isBlockedWorkspacePath("config/certificate.PEM")).toBe(true);
  });

  it("laat een gewoon bronbestand toe", () => {
    expect(
      isBlockedWorkspacePath("src/core/application/codebase/workspace-reader.ts"),
    ).toBe(false);
  });

  it("blokkeert geen mapnaam die slechts een geblokkeerde mapnaam bevat", () => {
    expect(isBlockedWorkspacePath("src/build-tools/index.ts")).toBe(false);
  });
});

describe("parseWorkspaceReadRequest", () => {
  it("retourneert null wanneer het requestblok ontbreekt", () => {
    expect(parseWorkspaceReadRequest('{"paths":["src/index.ts"]}')).toBe(null);
  });

  it("retourneert null bij ongeldige JSON in een correct gevormd blok", () => {
    expect(
      parseWorkspaceReadRequest(
        '<workspace-read>{"paths":["src/index.ts"],}</workspace-read>',
      ),
    ).toBe(null);
  });

  it("retourneert null wanneer paths ontbreekt of geen array is", () => {
    expect(parseWorkspaceReadRequest("<workspace-read>{}</workspace-read>")).toBe(
      null,
    );
    expect(
      parseWorkspaceReadRequest(
        '<workspace-read>{"paths":"src/index.ts"}</workspace-read>',
      ),
    ).toBe(null);
  });

  it("herkent het blok tussen tekst, met witruimte en andere hoofdletters", () => {
    const result = parseWorkspaceReadRequest(
      'Vooraf\n<WORKSPACE-READ>\n {"paths":["src/index.ts"]} \n</WORKSPACE-READ>\nAchteraf',
    );

    expect(JSON.stringify(result)).toBe('["src/index.ts"]');
  });

  it("normaliseert paden en voegt duplicaten samen in oorspronkelijke volgorde", () => {
    const result = parseWorkspaceReadRequest(
      `<workspace-read>${JSON.stringify({
        paths: [
          " ./src/index.ts ",
          "src/index.ts",
          "src\\index.ts",
          "src/other.ts",
          "./src/other.ts",
        ],
      })}</workspace-read>`,
    );

    expect(JSON.stringify(result)).toBe('["src/index.ts","src/other.ts"]');
  });

  it("negeert niet-strings en paden die na normalisatie leeg zijn", () => {
    const result = parseWorkspaceReadRequest(
      `<workspace-read>${JSON.stringify({
        paths: [null, 42, false, {}, "", "   ", "./", "src/index.ts"],
      })}</workspace-read>`,
    );

    expect(JSON.stringify(result)).toBe('["src/index.ts"]');
  });

  it("retourneert een lege array bij een lege padenlijst", () => {
    expect(
      JSON.stringify(
        parseWorkspaceReadRequest(
          '<workspace-read>{"paths":[]}</workspace-read>',
        ),
      ),
    ).toBe("[]");
  });

  it("behoudt maximaal de eerste 8 unieke paden na deduplicatie", () => {
    // MAX_FILES is 8 in de bron en is niet geëxporteerd.
    // Negen unieke toegestane paden, met een duplicaat vóór de limiet.
    const paths = [
      "src/one.ts",
      "src/one.ts",
      "src/two.ts",
      "src/three.ts",
      "src/four.ts",
      "src/five.ts",
      "src/six.ts",
      "src/seven.ts",
      "src/eight.ts",
      "src/nine.ts",
    ];

    for (const relativePath of paths) {
      expect(isBlockedWorkspacePath(relativePath)).toBe(false);
    }

    const result = parseWorkspaceReadRequest(
      `<workspace-read>${JSON.stringify({ paths })}</workspace-read>`,
    );

    expect(JSON.stringify(result)).toBe(
      '["src/one.ts","src/two.ts","src/three.ts","src/four.ts","src/five.ts","src/six.ts","src/seven.ts","src/eight.ts"]',
    );
  });
});

describe("formatWorkspaceReadResults", () => {
  it("formatteert een fout als zelfsluitend element met een error-attribuut", () => {
    const result = formatWorkspaceReadResults([
      {
        relativePath: ".env",
        error: "Toegang tot dit bestand is geblokkeerd.",
      },
    ]);

    expect(result).toBe(
      '<workspace-file path=".env" error="Toegang tot dit bestand is geblokkeerd." />',
    );
  });

  it("formatteert inhoud met metadata, regeleindes en een sluitend element", () => {
    const result = formatWorkspaceReadResults([
      {
        relativePath: "src/index.ts",
        size: 19,
        modifiedAt: "2026-09-13T12:00:00.000Z",
        content: "regel een\nregel twee",
      },
    ]);

    expect(result).toBe(
      '<workspace-file path="src/index.ts" size="19" modified-at="2026-09-13T12:00:00.000Z">\nregel een\nregel twee\n</workspace-file>',
    );
  });

  it("behoudt de volgorde en scheidt fout- en inhoudsresultaten met een lege regel", () => {
    const result = formatWorkspaceReadResults([
      {
        relativePath: ".env",
        error: "Toegang tot dit bestand is geblokkeerd.",
      },
      {
        relativePath: "src/index.ts",
        size: 0,
        modifiedAt: "2026-09-13T12:00:00.000Z",
        content: "",
      },
    ]);

    expect(result).toBe(
      '<workspace-file path=".env" error="Toegang tot dit bestand is geblokkeerd." />\n\n<workspace-file path="src/index.ts" size="0" modified-at="2026-09-13T12:00:00.000Z">\n\n</workspace-file>',
    );
  });

  it("retourneert een lege string wanneer er geen resultaten zijn", () => {
    expect(formatWorkspaceReadResults([])).toBe("");
  });
});
