import { describe, expect, it } from "vitest";

import {
  condenseJobLog,
  extractJobIdFromDetailsUrl,
  formatCiFailureReport,
  stripLogTimestamp,
} from "./ci-failure-report";

describe("extractJobIdFromDetailsUrl", () => {
  it("haalt het taaknummer uit de details-URL van een check-run", () => {
    expect(
      extractJobIdFromDetailsUrl(
        "https://github.com/The-Dost-Matrix/the-dost-matrix/actions/runs/123456/job/987654",
      ),
    ).toBe("987654");
  });

  it("geeft null bij een URL zonder taaknummer, en bij ontbrekende invoer", () => {
    expect(
      extractJobIdFromDetailsUrl(
        "https://github.com/The-Dost-Matrix/the-dost-matrix/actions/runs/123456",
      ),
    ).toBeNull();
    expect(extractJobIdFromDetailsUrl(null)).toBeNull();
    expect(extractJobIdFromDetailsUrl(undefined)).toBeNull();
    expect(extractJobIdFromDetailsUrl("")).toBeNull();
  });
});

describe("stripLogTimestamp", () => {
  it("haalt het tijdstempel van GitHub weg", () => {
    expect(stripLogTimestamp("2026-09-06T15:04:05.1234567Z npm run typecheck")).toBe(
      "npm run typecheck",
    );
  });

  it("laat een regel zonder tijdstempel ongemoeid", () => {
    expect(stripLogTimestamp("src/x.ts(4,1): error TS2304")).toBe("src/x.ts(4,1): error TS2304");
  });
});

describe("condenseJobLog", () => {
  const LOG = [
    "2026-09-06T15:04:00.0000000Z ##[group]Run npm ci",
    "2026-09-06T15:04:01.0000000Z npm warn deprecated inflight@1.0.6",
    "2026-09-06T15:04:02.0000000Z added 412 packages",
    "2026-09-06T15:04:03.0000000Z ##[endgroup]",
    "2026-09-06T15:04:04.0000000Z > tsc --noEmit",
    "2026-09-06T15:04:05.0000000Z src/core/x.ts(12,7): error TS2551: Property 'upsert' does not exist on type 'Client'.",
    "2026-09-06T15:04:06.0000000Z ",
    "2026-09-06T15:04:07.0000000Z ##[error]Process completed with exit code 2.",
  ].join("\n");

  it("houdt de echte foutregel over en haalt de tijdstempels weg", () => {
    const condensed = condenseJobLog(LOG);

    expect(condensed).toContain("error TS2551");
    expect(condensed).toContain("Property 'upsert' does not exist");
    expect(condensed).not.toContain("2026-09-06T15:04");
  });

  it("laat installatie-ruis weg", () => {
    const condensed = condenseJobLog(LOG);

    expect(condensed).not.toContain("npm warn deprecated");
    expect(condensed).not.toContain("added 412 packages");
  });

  it("neemt de regel vóór de fout mee als context", () => {
    const condensed = condenseJobLog(LOG);

    expect(condensed).toContain("> tsc --noEmit");
  });

  it("markeert weggelaten stukken met [...]", () => {
    const condensed = condenseJobLog(LOG);

    expect(condensed).toContain("[...]");
  });

  it("valt terug op de laatste regels wanneer geen enkele regel op een fout wijst", () => {
    const boring = ["stap een", "stap twee", "stap drie"].join("\n");

    // Met de markering vooraan, omdat "stap een" is weggelaten: het logboek
    // begint niet bij "stap twee" en dat moet zichtbaar zijn.
    expect(condenseJobLog(boring, 2)).toBe("[...]\nstap twee\nstap drie");
  });

  it("zet geen markering wanneer er niets is weggelaten", () => {
    const short = ["stap een", "stap twee"].join("\n");

    expect(condenseJobLog(short, 5)).toBe("stap een\nstap twee");
  });

  it("houdt zich aan het maximum aantal regels", () => {
    const many = Array.from({ length: 200 }, (_, index) => `error nummer ${index}`).join("\n");

    const condensed = condenseJobLog(many, 10);

    expect(condensed.split("\n").filter((line) => line !== "[...]")).toHaveLength(10);
  });

  it("geeft een lege tekst terug bij een leeg logboek", () => {
    expect(condenseJobLog("")).toBe("");
  });
});

describe("formatCiFailureReport", () => {
  const BASE = {
    checkName: "CI / Typecheck & import-check",
    annotations: [],
    jobLog: null,
  };

  it("zegt het expliciet wanneer er niets te melden valt", () => {
    expect(formatCiFailureReport([])).toContain("Geen gefaalde CI-controles");
  });

  it("noemt de naam van de gefaalde controle", () => {
    expect(formatCiFailureReport([BASE])).toContain("CI / Typecheck & import-check");
  });

  it("neemt de door GitHub aangewezen bestanden en regels op", () => {
    const report = formatCiFailureReport([
      {
        ...BASE,
        annotations: [
          {
            path: "src/core/x.ts",
            startLine: 12,
            level: "failure",
            message: "Property 'upsert' does not exist on type 'Client'.",
          },
        ],
      },
    ]);

    expect(report).toContain("src/core/x.ts:12");
    expect(report).toContain("Property 'upsert' does not exist");
  });

  it("noemt een aangewezen bestand zonder regelnummer zonder dubbele punt", () => {
    const report = formatCiFailureReport([
      {
        ...BASE,
        annotations: [
          { path: "src/core/x.ts", startLine: null, level: "failure", message: "Iets mis." },
        ],
      },
    ]);

    expect(report).toContain("src/core/x.ts (failure)");
  });

  it("zegt expliciet dat het logboek ontbreekt, met de reden erbij", () => {
    const report = formatCiFailureReport([
      {
        ...BASE,
        jobLog: null,
        jobLogUnavailableReason: "de GitHub App mist de permissie Actions: Read",
      },
    ]);

    expect(report).toContain("NIET opgehaald");
    expect(report).toContain("Actions: Read");
    expect(report).toContain("mogelijk onvolledig");
  });

  it("neemt de relevante logregels op wanneer het logboek er wel is", () => {
    const report = formatCiFailureReport([
      {
        ...BASE,
        jobLog: "> tsc --noEmit\nsrc/core/x.ts(3,1): error TS2304: Cannot find name 'foo'.",
      },
    ]);

    expect(report).toContain("Cannot find name 'foo'");
    expect(report).not.toContain("NIET opgehaald");
  });

  it("beschrijft meerdere gefaalde controles achter elkaar", () => {
    const report = formatCiFailureReport([
      { ...BASE, checkName: "controle een" },
      { ...BASE, checkName: "controle twee" },
    ]);

    expect(report).toContain("controle een");
    expect(report).toContain("controle twee");
  });

  it("kapt een te lang verslag af en zegt dat erbij", () => {
    const report = formatCiFailureReport(
      [{ ...BASE, jobLog: Array.from({ length: 50 }, () => "error x".repeat(40)).join("\n") }],
      200,
    );

    expect(report.length).toBeLessThan(400);
    expect(report).toContain("afgekapt");
  });
});
