import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * proposeMissionKnowledge praat met drie losse modules; alle drie worden hier
 * gemockt zodat het gedrag van de functie zelf getest kan worden zonder een
 * echte LLM-aanroep en zonder Firestore-writes.
 *
 * Let op twee details die uit de echte broncode komen (en waarop een eerdere
 * poging tot dit testbestand stukliep):
 * - `proposeMissionKnowledge(mission, outcome)` neemt TWEE argumenten; het
 *   outcome ("completed" | "failed" | "cancelled") is een apart argument en
 *   geen veld op de missie.
 * - `reviewKnowledgeItems` is een SYNCHRONE functie (geen async, geeft
 *   rechtstreeks een array terug), dus die wordt gemockt met mockReturnValue
 *   en niet met mockResolvedValue. De productiecode doet `const reviewed =
 *   reviewKnowledgeItems(items)` zonder await; een Promise als returnwaarde
 *   zou daar stilzwijgend stukgaan op de daaropvolgende for-of.
 */
vi.mock("@/core/llm/model-router", () => ({
  getChatProvider: vi.fn(),
}));

vi.mock("@/core/knowledge/knowledge-architect", () => ({
  reviewKnowledgeItems: vi.fn(),
}));

vi.mock("@/core/repositories/knowledge-repository", () => ({
  createKnowledgeEntry: vi.fn(),
}));

import { getChatProvider } from "@/core/llm/model-router";
import { reviewKnowledgeItems } from "@/core/knowledge/knowledge-architect";
import { createKnowledgeEntry } from "@/core/repositories/knowledge-repository";

import { proposeMissionKnowledge } from "./mission-knowledge";
import type { MissionV2 } from "./mission";

const chatCompletion = vi.fn();

/**
 * Alleen de velden die proposeMissionKnowledge daadwerkelijk uitleest:
 * ownerId, missionId, title, objective, successCriteria (description/status/
 * lastEvaluationNote) en assignments (roleId/status/objective).
 */
function buildMission(overrides: Record<string, unknown> = {}): MissionV2 {
  return {
    missionId: "abc12345-0000-0000-0000-000000000000",
    ownerId: "owner-1",
    title: "Voorbeeldmissie",
    objective: "Iets duurzaams opleveren.",
    successCriteria: [
      { description: "Criterium één", status: "PASSED", lastEvaluationNote: "Bevestigd door QA." },
    ],
    assignments: [
      { roleId: "builder", status: "COMPLETED", objective: "Schrijf de code." },
    ],
    ...overrides,
  } as unknown as MissionV2;
}

function llmResponse(items: unknown): { content: string } {
  return { content: JSON.stringify(items) };
}

const VALID_ITEM = {
  title: "Fail-open bij kennisextractie",
  content: "Een fout in de kennisextractie mag de afronding van een missie nooit blokkeren.",
  type: "lesson",
  tags: ["second-brain"],
};

describe("proposeMissionKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getChatProvider).mockReturnValue({
      id: "test-provider",
      chatCompletion,
    } as never);
    // De productiecode logt bewust naar console.error in het fail-open-pad;
    // hier onderdrukt (en waar relevant gecontroleerd) om de testuitvoer
    // leesbaar te houden.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("legt elk doorgelaten kennisitem vast met status 'pending' en bron 'mission'", async () => {
    chatCompletion.mockResolvedValue(llmResponse([VALID_ITEM]));
    vi.mocked(reviewKnowledgeItems).mockReturnValue([
      { ...VALID_ITEM, type: "lesson", lifecycle: "foundation" },
    ] as never);

    await proposeMissionKnowledge(buildMission(), "completed");

    expect(reviewKnowledgeItems).toHaveBeenCalledTimes(1);
    expect(createKnowledgeEntry).toHaveBeenCalledTimes(1);
    expect(createKnowledgeEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        title: VALID_ITEM.title,
        content: VALID_ITEM.content,
        type: "lesson",
        source: "mission",
        status: "pending",
        tags: expect.arrayContaining(["missie", "completed"]),
      }),
    );
  });

  it("gooit zelf geen fout wanneer de LLM-aanroep mislukt, en legt niets vast (fail-open)", async () => {
    chatCompletion.mockRejectedValue(new Error("LLM-provider tijdelijk niet beschikbaar"));

    await expect(proposeMissionKnowledge(buildMission(), "completed")).resolves.toBeUndefined();

    expect(createKnowledgeEntry).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it("gooit zelf geen fout wanneer de LLM geen geldige JSON teruggeeft, en legt niets vast (fail-open)", async () => {
    chatCompletion.mockResolvedValue({
      content: "Dit is gewoon lopende tekst zonder JSON-structuur.",
    });

    await expect(proposeMissionKnowledge(buildMission(), "cancelled")).resolves.toBeUndefined();

    expect(createKnowledgeEntry).not.toHaveBeenCalled();
  });

  it("legt niets vast wanneer reviewKnowledgeItems alles wegfiltert", async () => {
    chatCompletion.mockResolvedValue(llmResponse([VALID_ITEM]));
    vi.mocked(reviewKnowledgeItems).mockReturnValue([]);

    await proposeMissionKnowledge(buildMission(), "completed");

    expect(reviewKnowledgeItems).toHaveBeenCalledTimes(1);
    expect(createKnowledgeEntry).not.toHaveBeenCalled();
  });

  it("filtert items met een ontbrekend of onbekend type al vóór reviewKnowledgeItems weg", async () => {
    chatCompletion.mockResolvedValue(
      llmResponse([
        { title: "Zonder type", content: "Mist het type-veld volledig." },
        { title: "Onbekend type", content: "Type bestaat niet.", type: "verzonnen-type" },
        VALID_ITEM,
      ]),
    );
    vi.mocked(reviewKnowledgeItems).mockReturnValue([]);

    await proposeMissionKnowledge(buildMission(), "completed");

    expect(reviewKnowledgeItems).toHaveBeenCalledWith([
      expect.objectContaining({ title: VALID_ITEM.title, type: "lesson" }),
    ]);
  });

  it("gooit zelf geen fout wanneer het wegschrijven van een kennisitem mislukt (fail-open)", async () => {
    chatCompletion.mockResolvedValue(llmResponse([VALID_ITEM]));
    vi.mocked(reviewKnowledgeItems).mockReturnValue([
      { ...VALID_ITEM, type: "lesson", lifecycle: "foundation" },
    ] as never);
    vi.mocked(createKnowledgeEntry).mockRejectedValue(new Error("Firestore niet bereikbaar"));

    await expect(proposeMissionKnowledge(buildMission(), "completed")).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalled();
  });
});
