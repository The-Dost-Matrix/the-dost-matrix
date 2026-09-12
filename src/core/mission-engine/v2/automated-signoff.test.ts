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
import { reviewPullRequestForAutomatedSignoff } from "./automated-signoff";
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
