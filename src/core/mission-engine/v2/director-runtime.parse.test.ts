import { describe, expect, it, vi } from "vitest";

/**
 * director-runtime.ts trekt (indirect) `@/core/firebase/admin` binnen, dat op
 * moduleniveau meteen de Firebase Admin SDK initialiseert. Zonder deze mock
 * crasht elke test die dit bestand importeert al bij het laden — dezelfde
 * mock als in director-runtime.test.ts.
 */
vi.mock("@/core/firebase/admin", () => ({
  adminAuth: {},
  adminDb: {},
  verifyIdToken: vi.fn(),
}));

import {
  MAX_DIRECTOR_ERROR_EXCERPT,
  buildDirectorParseErrorMessage,
  extractJson,
} from "./director-runtime";

describe("extractJson", () => {
  it("leest kaal JSON", () => {
    expect(extractJson('{"decisionType":"COMPLETE_MISSION"}')).toBe(
      '{"decisionType":"COMPLETE_MISSION"}',
    );
  });

  it("haalt JSON uit een codeblok", () => {
    const answer = ['```json', '{"decisionType":"DISPATCH_ROLE"}', "```"].join("\n");

    expect(extractJson(answer)).toBe('{"decisionType":"DISPATCH_ROLE"}');
  });

  it("haalt JSON uit een codeblok zonder taalaanduiding", () => {
    const answer = ["```", '{"role":"qa"}', "```"].join("\n");

    expect(extractJson(answer)).toBe('{"role":"qa"}');
  });

  it("vindt het besluit ook wanneer het model er een zin voor zet", () => {
    // Dit is het geval waarop de oude versie stukliep: geldig besluit,
    // onbruikbare fout.
    const answer = 'Hier is mijn besluit: {"decisionType":"COMPLETE_MISSION"}';

    expect(extractJson(answer)).toBe('{"decisionType":"COMPLETE_MISSION"}');
  });

  it("negeert tekst na het besluit", () => {
    const answer = '{"role":"builder"} Laat me weten of dit klopt.';

    expect(extractJson(answer)).toBe('{"role":"builder"}');
  });

  it("neemt het buitenste object, niet het eerste geneste", () => {
    const answer = 'Besluit: {"a":{"b":1},"c":2} klaar';

    expect(extractJson(answer)).toBe('{"a":{"b":1},"c":2}');
  });

  it("geeft de tekst ongewijzigd terug wanneer er geen object in zit, zodat JSON.parse de fout maakt", () => {
    expect(extractJson("helemaal geen JSON")).toBe("helemaal geen JSON");
  });

  it("laat zich niet misleiden door codehekken binnen een tekstwaarde", () => {
    // Dit is het echte antwoord dat op 7 september 2026 een missie liet
    // vastlopen, teruggebracht tot het kenmerk dat ertoe deed: de Director
    // beschreef in nextAction dat de Builder moest testen op markdown-hekken,
    // en schreef die hekken daarmee middenin een geldige JSON-tekstwaarde.
    // De oude versie knipte tussen die hekken en hield "..." over.
    const answer = [
      "{",
      '  "decisionType": "DISPATCH_ROLE",',
      '  "role": "builder",',
      '  "nextAction": "Test dat een antwoord in codehekken (```json ... ```) alsnog gelezen wordt.",',
      '  "successCriteria": ["De CI is groen."]',
      "}",
    ].join("\n");

    const extracted = extractJson(answer);

    expect(extracted).not.toBe("...");
    expect((JSON.parse(extracted) as { role: string }).role).toBe("builder");
  });

  it("neemt nog steeds de inhoud van een codeblok wanneer het antwoord zelf niet leesbaar is", () => {
    const answer = ["Hier is het besluit.", "```json", '{"role":"qa"}', "```", "Groet!"].join("\n");

    expect(JSON.parse(extractJson(answer))).toEqual({ role: "qa" });
  });
});

describe("buildDirectorParseErrorMessage", () => {
  it("zet de reden van stoppen in de melding, zodat afkappen te onderscheiden is van kletsen", () => {
    const message = buildDirectorParseErrorMessage("Hier is mijn besluit", "length");

    expect(message).toContain("length");
  });

  it("zegt 'onbekend' wanneer de provider geen reden meegaf", () => {
    expect(buildDirectorParseErrorMessage("iets", undefined)).toContain("onbekend");
  });

  it("toont het begin van het antwoord zelf, want dat is het bewijs", () => {
    const message = buildDirectorParseErrorMessage("Natuurlijk! Even kijken...", "stop");

    expect(message).toContain("Natuurlijk! Even kijken...");
  });

  it("kapt een lang antwoord af en laat zien dat er meer was", () => {
    const long = "x".repeat(MAX_DIRECTOR_ERROR_EXCERPT + 50);
    const message = buildDirectorParseErrorMessage(long, "stop");

    expect(message).toContain("…");
    expect(message).toContain(`${long.length} tekens`);
    expect(message).not.toContain("x".repeat(MAX_DIRECTOR_ERROR_EXCERPT + 1));
  });

  it("blijft leesbaar bij een leeg antwoord", () => {
    const message = buildDirectorParseErrorMessage("   ", "stop");

    expect(message).toContain("(leeg)");
    expect(message).toContain("0 tekens");
  });
});
