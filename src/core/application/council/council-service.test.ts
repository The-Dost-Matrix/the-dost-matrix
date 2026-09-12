import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * runCouncilSession orkestreert vier LLM-aanroepen (2 leden x 2 ronden) via
 * getCouncilProviders (@/core/llm/model-router) en bouwt het bewijspakket via
 * dezelfde functies als chat-service.ts (readWorkspaceFiles,
 * collectProjectSignals, buildProjectStateBlock, listMissionsForOwner) — hier
 * allemaal gemockt, zodat dit bestand zonder netwerk of Firestore draait.
 *
 * Waar dit op let, rechtstreeks uit de roadmap-spec voor Stap 13:
 * - ronde 1 is BLIND: geen van beide providers krijgt in ronde 1 iets van de
 *   ander te zien.
 * - ronde 2 krijgt elk lid uitsluitend het ronde-1-antwoord van het ANDERE
 *   lid, nooit zijn eigen antwoord terug.
 * - het oordeel (ronde 3) wordt deterministisch in code bepaald — geen derde
 *   LLM-aanroep — en telt ONDUIDELIJK nooit als instemming.
 */

const anthropicChatCompletion = vi.fn();
const openaiChatCompletion = vi.fn();

vi.mock("@/core/llm/model-router", () => ({
  getCouncilProviders: vi.fn(),
}));

vi.mock("@/core/application/codebase/workspace-reader", () => ({
  readWorkspaceFiles: vi.fn(),
}));

vi.mock("@/core/application/director/project-signals", () => ({
  ROADMAP_PATH: "docs/roadmap.md",
  collectProjectSignals: vi.fn(),
}));

vi.mock("@/core/application/director/project-state", () => ({
  buildProjectStateBlock: vi.fn(() => "PROJECTSTAND-BLOK"),
}));

vi.mock("@/core/mission-engine/v2/firestore-store", () => ({
  listMissionsForOwner: vi.fn(),
}));

import { getCouncilProviders } from "@/core/llm/model-router";
import { readWorkspaceFiles } from "@/core/application/codebase/workspace-reader";
import { collectProjectSignals } from "@/core/application/director/project-signals";
import { listMissionsForOwner } from "@/core/mission-engine/v2/firestore-store";

import { runCouncilSession } from "./council-service";

function setUpEvidenceMocks() {
  vi.mocked(readWorkspaceFiles).mockResolvedValue([
    { path: "docs/roadmap.md", content: "ROADMAP" } as never,
  ]);
  vi.mocked(listMissionsForOwner).mockResolvedValue([]);
  vi.mocked(collectProjectSignals).mockResolvedValue({
    openPullRequests: null,
    pendingKnowledgeCount: null,
    roadmapFreshness: null,
  });
}

function setUpProviders() {
  vi.mocked(getCouncilProviders).mockReturnValue({
    anthropic: { id: "anthropic", chatCompletion: anthropicChatCompletion },
    openai: { id: "openai", chatCompletion: openaiChatCompletion },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setUpEvidenceMocks();
  setUpProviders();
});

describe("runCouncilSession", () => {
  it("gooit een fout bij een lege vraag, zonder providers aan te roepen", async () => {
    await expect(runCouncilSession("owner_1", "   ")).rejects.toThrow(
      "mag niet leeg zijn",
    );
    expect(anthropicChatCompletion).not.toHaveBeenCalled();
  });

  it("voert ronde 1 blind en parallel uit: geen van beide aanroepen bevat het antwoord van de ander", async () => {
    anthropicChatCompletion
      .mockResolvedValueOnce({ content: "Anthropic ronde 1", model: "anthropic/claude-sonnet-5" })
      .mockResolvedValueOnce({ content: "Anthropic ronde 2\n<oordeel>EENS</oordeel>", model: "anthropic/claude-sonnet-5" });
    openaiChatCompletion
      .mockResolvedValueOnce({ content: "OpenAI ronde 1", model: "openai/gpt-4o" })
      .mockResolvedValueOnce({ content: "OpenAI ronde 2\n<oordeel>EENS</oordeel>", model: "openai/gpt-4o" });

    await runCouncilSession("owner_1", "Moeten we stap 16 nu doen?");

    const anthropicRoundOneMessages = anthropicChatCompletion.mock.calls[0][1];
    const openaiRoundOneMessages = openaiChatCompletion.mock.calls[0][1];

    expect(JSON.stringify(anthropicRoundOneMessages)).not.toContain("OpenAI");
    expect(JSON.stringify(openaiRoundOneMessages)).not.toContain("Anthropic");
  });

  it("geeft in ronde 2 elk lid uitsluitend het ANDERE ronde-1-antwoord, niet het eigen antwoord", async () => {
    anthropicChatCompletion
      .mockResolvedValueOnce({ content: "Anthropic-standpunt", model: "anthropic/claude-sonnet-5" })
      .mockResolvedValueOnce({ content: "kritiek\n<oordeel>EENS</oordeel>", model: "anthropic/claude-sonnet-5" });
    openaiChatCompletion
      .mockResolvedValueOnce({ content: "OpenAI-standpunt", model: "openai/gpt-4o" })
      .mockResolvedValueOnce({ content: "kritiek\n<oordeel>EENS</oordeel>", model: "openai/gpt-4o" });

    await runCouncilSession("owner_1", "Een vraag");

    const anthropicRoundTwoMessages = anthropicChatCompletion.mock.calls[1][1];
    const openaiRoundTwoMessages = openaiChatCompletion.mock.calls[1][1];

    expect(JSON.stringify(anthropicRoundTwoMessages)).toContain("OpenAI-standpunt");
    expect(JSON.stringify(anthropicRoundTwoMessages)).not.toContain("Anthropic-standpunt");
    expect(JSON.stringify(openaiRoundTwoMessages)).toContain("Anthropic-standpunt");
    expect(JSON.stringify(openaiRoundTwoMessages)).not.toContain("OpenAI-standpunt");
  });

  it("bepaalt agreement=true alleen wanneer BEIDE leden expliciet EENS zeggen", async () => {
    anthropicChatCompletion
      .mockResolvedValueOnce({ content: "a1", model: "anthropic/claude-sonnet-5" })
      .mockResolvedValueOnce({ content: "kritiek\n<oordeel>EENS</oordeel>", model: "anthropic/claude-sonnet-5" });
    openaiChatCompletion
      .mockResolvedValueOnce({ content: "o1", model: "openai/gpt-4o" })
      .mockResolvedValueOnce({ content: "kritiek\n<oordeel>EENS</oordeel>", model: "openai/gpt-4o" });

    const result = await runCouncilSession("owner_1", "Een vraag");
    expect(result.agreement).toBe(true);
    expect(result.members).toHaveLength(2);
  });

  it("bepaalt agreement=false zodra één lid ONEENS zegt", async () => {
    anthropicChatCompletion
      .mockResolvedValueOnce({ content: "a1", model: "anthropic/claude-sonnet-5" })
      .mockResolvedValueOnce({ content: "kritiek\n<oordeel>ONEENS</oordeel>", model: "anthropic/claude-sonnet-5" });
    openaiChatCompletion
      .mockResolvedValueOnce({ content: "o1", model: "openai/gpt-4o" })
      .mockResolvedValueOnce({ content: "kritiek\n<oordeel>EENS</oordeel>", model: "openai/gpt-4o" });

    const result = await runCouncilSession("owner_1", "Een vraag");
    expect(result.agreement).toBe(false);
  });

  it("bepaalt agreement=false wanneer een lid geen leesbaar oordeel geeft (ONDUIDELIJK telt nooit als instemming)", async () => {
    anthropicChatCompletion
      .mockResolvedValueOnce({ content: "a1", model: "anthropic/claude-sonnet-5" })
      .mockResolvedValueOnce({ content: "geen tag hier", model: "anthropic/claude-sonnet-5" });
    openaiChatCompletion
      .mockResolvedValueOnce({ content: "o1", model: "openai/gpt-4o" })
      .mockResolvedValueOnce({ content: "kritiek\n<oordeel>EENS</oordeel>", model: "openai/gpt-4o" });

    const result = await runCouncilSession("owner_1", "Een vraag");
    expect(result.agreement).toBe(false);
    expect(result.members.find((member) => member.providerId === "anthropic")?.verdict).toBe(
      "ONDUIDELIJK",
    );
  });

  it("telt kosten op over alle vier de aanroepen heen", async () => {
    const usage = { inputTokens: 100, outputTokens: 100 };
    anthropicChatCompletion
      .mockResolvedValueOnce({ content: "a1", model: "anthropic/claude-sonnet-5", usage })
      .mockResolvedValueOnce({ content: "kritiek\n<oordeel>EENS</oordeel>", model: "anthropic/claude-sonnet-5", usage });
    openaiChatCompletion
      .mockResolvedValueOnce({ content: "o1", model: "openai/gpt-4o", usage })
      .mockResolvedValueOnce({ content: "kritiek\n<oordeel>EENS</oordeel>", model: "openai/gpt-4o", usage });

    const result = await runCouncilSession("owner_1", "Een vraag");
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });
});
