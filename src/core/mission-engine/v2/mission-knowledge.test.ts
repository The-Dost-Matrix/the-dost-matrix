import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * proposeMissionKnowledge in mission-knowledge.ts haalt via getChatProvider()
 * een chat-provider op en roept daarop chatCompletion() aan om kennis uit een
 * afgesloten missie te destilleren. Zonder deze mock zou de test een echte
 * (of niet-geconfigureerde) LLM-provider proberen te initialiseren.
 */
vi.mock("@/core/llm/model-router", () => ({
  getChatProvider: vi.fn(),
}));

/**
 * reviewKnowledgeItems beoordeelt/filtert de door de LLM voorgestelde
 * kennisitems voordat ze als kennisitem worden vastgelegd. We mocken dit
 * apart zodat we per test kunnen sturen welke items "blijvende waarde"
 * hebben, onafhankelijk van de LLM-output zelf.
 */
vi.mock("@/core/knowledge/knowledge-architect", () => ({
  reviewKnowledgeItems: vi.fn(),
}));

/**
 * createKnowledgeEntry schrijft een kennisitem weg via de repository-laag.
 * Deze mocken we om (a) echte Firestore-writes te vermijden en (b) precies
 * te kunnen verifiëren met welke argumenten, en hoe vaak, de functie wordt
 * aangeroepen.
 */
vi.mock("@/core/repositories/knowledge-repository", () => ({
  createKnowledgeEntry: vi.fn(),
}));

import { proposeMissionKnowledge } from "./mission-knowledge";
import { getChatProvider } from "@/core/llm/model-router";
import { reviewKnowledgeItems } from "@/core/knowledge/knowledge-architect";
import { createKnowledgeEntry } from "@/core/repositories/knowledge-repository";

// De gemockte chatCompletion-methode van de door getChatProvider()
// teruggegeven provider. Wordt in beforeEach gekoppeld aan de mock van
// getChatProvider, zodat elke test hem vrij kan configureren met
// mockResolvedValue/mockRejectedValue.
const chatCompletion = vi.fn();

/**
 * Bouwt een geldig MissionV2-achtig testfixture-object met de velden die de
 * opdracht expliciet vereist (missionId, title, objective, ownerId,
 * successCriteria, assignments), plus een outcome-veld ("completed"), zoals
 * proposeMissionKnowledge functioneel alleen wordt aangeroepen voor
 * afgesloten missies ("completed" of "cancelled").
 */
function buildMockMission(overrides: Record<string, unknown> = {}) {
  return {
    missionId: "mission-1",
    title: "Verbeter de onboarding-flow",
    objective: "Zorg dat nieuwe gebruikers binnen 2 minuten hun eerste actie voltooien.",
    ownerId: "owner-1",
    successCriteria: [
      "Minder dan 5% drop-off in stap 1 van de onboarding",
      "Onboarding gemiddeld voltooid binnen 2 minuten",
    ],
    assignments: [],
    outcome: "completed",
    ...overrides,
  };
}

describe("proposeMissionKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // getChatProvider() geeft de gemockte provider terug met een
    // controleerbare chatCompletion()-methode. Werkt zowel als de
    // productiecode dit synchroon als met await aanroept.
    vi.mocked(getChatProvider).mockReturnValue({ chatCompletion } as never);
  });

  it("legt voor elk door reviewKnowledgeItems doorgelaten kennisitem een kennisitem vast met status 'pending', wanneer chatCompletion een geldige JSON-array teroggeeft", async () => {
    const proposedItems = [
      { title: "Vroegtijdige signup-friction", content: "Gebruikers haakten af bij het e-mailveld." },
      { title: "Onboarding-copy te lang", content: "De introtekst was te uitgebreid voor mobiel." },
    ];
    chatCompletion.mockResolvedValue({ content: JSON.stringify(proposedItems) });

    // reviewKnowledgeItems laat slechts een subset van de voorgestelde
    // items door (het tweede item wordt gefilterd als niet blijvend waardevol).
    const reviewedItems = [proposedItems[0]];
    vi.mocked(reviewKnowledgeItems).mockResolvedValue(reviewedItems as never);

    const mission = buildMockMission();

    await proposeMissionKnowledge(mission as never);

    expect(reviewKnowledgeItems).toHaveBeenCalledTimes(1);
    expect(createKnowledgeEntry).toHaveBeenCalledTimes(reviewedItems.length);
    expect(createKnowledgeEntry).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
    );
  });

  it("gooit zelf geen fout en roept createKnowledgeEntry niet aan wanneer chatCompletion een afgewezen Promise geeft (fail-open)", async () => {
    chatCompletion.mockRejectedValue(new Error("LLM-provider tijdelijk niet beschikbaar"));

    const mission = buildMockMission({ missionId: "mission-2" });

    await expect(proposeMissionKnowledge(mission as never)).resolves.not.toThrow();

    expect(createKnowledgeEntry).not.toHaveBeenCalled();
  });

  it("gooit zelf geen fout en roept createKnowledgeEntry niet aan wanneer chatCompletion ongeldige (niet-JSON) tekst teruggeeft (fail-open)", async () => {
    chatCompletion.mockResolvedValue({
      content: "Dit is gewoon een lopende tekst zonder enige JSON-structuur erin.",
    });

    const mission = buildMockMission({ missionId: "mission-3" });

    await expect(proposeMissionKnowledge(mission as never)).resolves.not.toThrow();

    expect(createKnowledgeEntry).not.toHaveBeenCalled();
  });

  it("roept createKnowledgeEntry helemaal niet aan wanneer reviewKnowledgeItems een lege array teruggeeft", async () => {
    const proposedItems = [
      { title: "Niet blijvend waardevol inzicht", content: "Eenmalige, missie-specifieke opmerking." },
    ];
    chatCompletion.mockResolvedValue({ content: JSON.stringify(proposedItems) });
    vi.mocked(reviewKnowledgeItems).mockResolvedValue([] as never);

    const mission = buildMockMission({ missionId: "mission-4" });

    await proposeMissionKnowledge(mission as never);

    expect(reviewKnowledgeItems).toHaveBeenCalledTimes(1);
    expect(createKnowledgeEntry).not.toHaveBeenCalled();
  });
});