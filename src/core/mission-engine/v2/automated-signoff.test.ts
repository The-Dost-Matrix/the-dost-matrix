import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Zelfde reden als in council-service.test.ts: model-router.ts importeert
 * de echte provider-fabrieken (die op hun beurt API-sleutels uit
 * process.env lezen), dus zonder deze mock zou elke test hier een echte
 * provider-selectie proberen te maken in plaats van de gemockte
 * chatCompletion hieronder te gebruiken.
 */
vi.mock("@/core/llm/model-router", () => ({
  getChatProvider: vi.fn(),
}));

import { getChatProvider } from "@/core/llm/model-router";
import {
  MAX_TOTAL_DIFF_CHARS,
  MIN_PATCH_CHARS_PER_FILE,
  SYSTEM_PROMPT,
  allocateDiffBudget,
  buildDiffBlock,
  reviewPullRequestForAutomatedSignoff,
} from "./automated-signoff";
import type { PullRequestFileChange } from "./github/github-client";
import type { MissionV2 } from "./mission";

function buildMission(overrides: Partial<MissionV2> = {}): MissionV2 {
  return {
    missionId: "abc12345-0000-0000-0000-000000000000",
    title: "Voorbeeldmissie",
    objective: "Een geïsoleerde utility-functie toevoegen.",
    riskLevel: "LOW",
    successCriteria: [{ description: "De nieuwe functie heeft unit tests." }],
    ...overrides,
  } as unknown as MissionV2;
}

function buildFiles(): PullRequestFileChange[] {
  return [
    {
      filename: "src/utils/format-currency.ts",
      status: "added",
      patch: "+export function formatCurrency(cents: number) {\n+  return (cents / 100).toFixed(2);\n+}",
    },
  ];
}

function mockCompletion(content: string) {
  vi.mocked(getChatProvider).mockReturnValue({
    id: "test-provider",
    chatCompletion: vi.fn().mockResolvedValue({ content, model: "test-model" }),
  });
}

describe("reviewPullRequestForAutomatedSignoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keurt goed wanneer het model expliciet AKKOORD zegt", async () => {
    mockCompletion(
      "Deze wijziging doet precies wat de missie vraagt, netjes geïsoleerd.\n<oordeel>AKKOORD</oordeel>",
    );

    const result = await reviewPullRequestForAutomatedSignoff(buildMission(), buildFiles());

    expect(result.approved).toBe(true);
  });

  it("wijst af wanneer het model expliciet ESCALEREN zegt", async () => {
    mockCompletion(
      "Deze wijziging doet meer dan gevraagd.\n<oordeel>ESCALEREN</oordeel>",
    );

    const result = await reviewPullRequestForAutomatedSignoff(buildMission(), buildFiles());

    expect(result.approved).toBe(false);
    expect(result.reason).toContain("meer dan gevraagd");
  });

  it("wijst af (escaleert) wanneer er helemaal geen oordeel-tag in het antwoord staat", async () => {
    mockCompletion("Dit ziet er verder prima uit.");

    const result = await reviewPullRequestForAutomatedSignoff(buildMission(), buildFiles());

    expect(result.approved).toBe(false);
  });

  it("wijst af (escaleert) wanneer de oordeel-tag een onherkenbare waarde bevat", async () => {
    mockCompletion("<oordeel>MISSCHIEN</oordeel>");

    const result = await reviewPullRequestForAutomatedSignoff(buildMission(), buildFiles());

    expect(result.approved).toBe(false);
  });

  it("neemt bij meerdere tags de LAATSTE, zoals parseCouncilVerdict in council-texts.ts", async () => {
    mockCompletion(
      "Eerst dacht ik <oordeel>ESCALEREN</oordeel> maar na nader inzien:\n<oordeel>AKKOORD</oordeel>",
    );

    const result = await reviewPullRequestForAutomatedSignoff(buildMission(), buildFiles());

    expect(result.approved).toBe(true);
  });

  it("stuurt de missietitel, het doel en de diff van elk bestand mee in het promptbericht", async () => {
    mockCompletion("<oordeel>AKKOORD</oordeel>");
    const provider = { id: "test-provider", chatCompletion: vi.fn().mockResolvedValue({ content: "<oordeel>AKKOORD</oordeel>", model: "test-model" }) };
    vi.mocked(getChatProvider).mockReturnValue(provider);

    await reviewPullRequestForAutomatedSignoff(buildMission(), buildFiles());

    const [, messages] = provider.chatCompletion.mock.calls[0];
    const userMessage = messages[0].content as string;

    expect(userMessage).toContain("Voorbeeldmissie");
    expect(userMessage).toContain("Een geïsoleerde utility-functie toevoegen.");
    expect(userMessage).toContain("formatCurrency");
  });
});

/**
 * De afstelling van de instructie, vastgelegd op 18 september 2026.
 *
 * Deze test kijkt naar de tekst van een prompt, en dat is ongebruikelijk. De
 * reden staat in de toelichting bovenaan automated-signoff.ts: de eerste versie
 * eindigde met "twijfel je, ook maar een beetje? Kies dan escaleren", en met
 * die zin erin heeft de beoordeling in twee livetests nooit iets goedgekeurd.
 * Elroy deed het werk dat hij juist had overgedragen. Zou die zin er ooit stil
 * weer insluipen, dan valt dat nergens aan op behalve aan het uitblijven van
 * automatische merges — precies het soort onzichtbaarheid waar dit project
 * tests voor schrijft.
 */
describe("de instructie voor de beoordelaar", () => {
  it("vraagt om een benoembaar risico in plaats van om afwezigheid van twijfel", () => {
    expect(SYSTEM_PROMPT).toContain("BENOEMEN");
    expect(SYSTEM_PROMPT).not.toContain("ook maar een beetje");
  });

  it("noemt expliciet wat géén reden tot escaleren is", () => {
    expect(SYSTEM_PROMPT).toContain("smaak, stijl");
  });

  it("laat de twee oordeelvormen ongewijzigd", () => {
    // parseAutomatedSignoffVerdict zoekt letterlijk naar deze twee regels;
    // veranderen ze in de instructie, dan herkent de code het oordeel niet meer
    // en telt alles als "niet goedgekeurd".
    expect(SYSTEM_PROMPT).toContain("<oordeel>AKKOORD</oordeel>");
    expect(SYSTEM_PROMPT).toContain("<oordeel>ESCALEREN</oordeel>");
  });
});

/**
 * Regressietests bij de reparatie van 18 september 2026. Zie de toelichting
 * boven buildDiffBlock: een vaste grens van 4.000 tekens per bestand kapte ook
 * af wanneer er geen ander bestand was om ruimte voor te maken, waardoor elke
 * pull request met één bestand daarboven automatisch escaleerde en deze hele
 * controle niet meer deed waarvoor ze bestaat.
 */
describe("buildDiffBlock", () => {
  function fileWithPatch(filename: string, patchLength: number): PullRequestFileChange {
    return {
      filename,
      status: "added",
      patch: `+${"x".repeat(patchLength - 1)}`,
    };
  }

  it("geeft één bestand het volle budget in plaats van een vaste 4.000 tekens", () => {
    // 6.165 tekens: precies de omvang waar PR #64 op strandde.
    const block = buildDiffBlock([fileWithPatch("src/a.ts", 6_165)]);

    expect(block).not.toContain("afgekapt");
    expect(block).toContain("src/a.ts");
    expect(block.length).toBeGreaterThan(6_000);
  });

  it("laat een groot en een klein bestand allebei volledig zien wanneer ze samen passen", () => {
    // PR #66, 19 september 2026. GitHub levert de bestanden alfabetisch, dus
    // het grote testbestand kwam eerst en kreeg precies de helft van het budget
    // (8.000) — 3.365 tekens afgekapt, terwijl het tweede bestand zijn eigen
    // helft niet eens nodig had. De beoordelaar escaleerde daarop, terecht.
    const block = buildDiffBlock([
      fileWithPatch("src/core/mission-engine/v2/mission-duration.test.ts", 11_365),
      fileWithPatch("src/core/mission-engine/v2/mission-duration.ts", 4_000),
    ]);

    expect(block).not.toContain("afgekapt");
    expect(block).not.toContain("weggelaten");
  });

  it("laat een realistische missie-oplevering van code plus tests volledig zien", () => {
    // Deze test bewaakt het PLAFOND zelf, niet de verdeling eronder. 40.000
    // tekens code met 40.000 tekens tests is een gewone, niet eens grote
    // oplevering — vele malen #64 (6.165) en #66 (11.365), de twee gevallen
    // waarop dit al eens strandde. Zakt MAX_TOTAL_DIFF_CHARS ooit terug naar
    // een getal waar zoiets niet meer in past, dan valt deze test om, en dat
    // hoort ook: dan wordt de beoordelaar weer blind gemaakt.
    const block = buildDiffBlock([
      fileWithPatch("src/core/toepassing.ts", 40_000),
      fileWithPatch("src/core/toepassing.test.ts", 40_000),
    ]);

    expect(block).not.toContain("afgekapt");
    expect(block).not.toContain("weggelaten");
  });

  it("verdeelt het budget van klein naar groot, ongeacht de volgorde in de lijst", () => {
    // De uitkomst hoort niet af te hangen van de volgorde waarin GitHub de
    // bestanden toevallig teruggeeft.
    const groot = fileWithPatch("src/groot.ts", 11_365);
    const klein = fileWithPatch("src/klein.ts", 4_000);

    expect(allocateDiffBudget([groot, klein])).toEqual([11_365, 4_000]);
    expect(allocateDiffBudget([klein, groot])).toEqual([4_000, 11_365]);
  });

  it("kapt een bestand dat het hele budget overschrijdt wél af, met vermelding", () => {
    // De harde grens op wat er naar het model gaat blijft staan; alleen de
    // verdeling eronder is veranderd. De omvang wordt hier afgeleid van de
    // constante zelf, zodat deze test blijft meten wat hij bedoelt te meten
    // wanneer het plafond ooit weer verschuift — op 19 september 2026 ging het
    // van 16.000 naar 200.000, en een vast getal van 40.000 zou toen stil zijn
    // gaan slagen om de verkeerde reden.
    const block = buildDiffBlock([
      fileWithPatch("src/groot.ts", MAX_TOTAL_DIFF_CHARS * 2),
    ]);

    expect(block).toContain("afgekapt");
    expect(block.length).toBeLessThan(MAX_TOTAL_DIFF_CHARS + 1_000);
  });

  it("laat tien kleine bestanden allemaal volledig zien", () => {
    const files = Array.from({ length: 10 }, (_, index) =>
      fileWithPatch(`src/bestand-${index}.ts`, 500),
    );

    const block = buildDiffBlock(files);

    for (const file of files) {
      expect(block).toContain(file.filename);
    }

    expect(block).not.toContain("afgekapt");
    expect(block).not.toContain("weggelaten");
  });

  it("meldt hoeveel bestanden er zijn weggelaten wanneer het budget opraakt", () => {
    // Weglaten gebeurt pas wanneer er zóveel bestanden zijn dat er voor het
    // volgende bestand geen zinnige portie meer over is — dus meer bestanden
    // dan het plafond gedeeld door de ondergrens. Bij 200.000 en 1.500 zijn
    // dat er ruim honderddertig. Vandaar dat het aantal hier uit die twee
    // constanten volgt in plaats van uit een vast getal.
    const count = Math.ceil(MAX_TOTAL_DIFF_CHARS / MIN_PATCH_CHARS_PER_FILE) + 10;

    const files = Array.from({ length: count }, (_, index) =>
      fileWithPatch(`src/bestand-${index}.ts`, MIN_PATCH_CHARS_PER_FILE * 2),
    );

    const block = buildDiffBlock(files);

    expect(block).toContain("src/bestand-0.ts");
    expect(block).not.toContain(`src/bestand-${count - 1}.ts`);
    expect(block).toMatch(/nog \d+ bestanden weggelaten/);
    expect(block.length).toBeLessThan(MAX_TOTAL_DIFF_CHARS + 10_000);
  });

  it("zegt het eerlijk wanneer GitHub geen diff meelevert", () => {
    const block = buildDiffBlock([
      { filename: "logo.png", status: "added", patch: undefined },
    ]);

    expect(block).toContain("geen diff beschikbaar");
  });
});
