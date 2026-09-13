import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests bij stap 24 (LLM-provider request-scoped maken).
 *
 * Het gedrag dat hier vastligt, is precies wat op 13 september 2026 misging.
 * De Anthropic-credits waren op, maar `getChatProvider()` bleef Anthropic
 * kiezen omdat die sleutel bestond — en de enige manier om dat te veranderen
 * was de sleutel weghalen uit Vercel en opnieuw deployen, wat meteen de Dost
 * Council omvergooide (die eist beide sleutels).
 *
 * De belangrijkste test hieronder is dan ook niet "openai kiezen werkt", maar
 * "openai kiezen terwijl de Anthropic-sleutel blijft staan" — dat is de hele
 * reden dat deze stap bestaat.
 */
vi.mock("@/core/llm/providers/anthropic-provider", () => ({
  ANTHROPIC_DEFAULT_CHAT_MODEL: "claude-sonnet-5",
  createAnthropicProvider: vi.fn((apiKey: string, model?: string) => ({
    id: "anthropic",
    model,
    chatCompletion: vi.fn(),
  })),
}));

vi.mock("@/core/llm/providers/openai-provider", () => ({
  OPENAI_DEFAULT_CHAT_MODEL: "gpt-4o",
  createOpenAiProvider: vi.fn((apiKey: string, model?: string) => ({
    id: "openai",
    model,
    chatCompletion: vi.fn(),
  })),
  createOpenAiEmbeddingProvider: vi.fn(() => ({ id: "openai-embeddings", embed: vi.fn() })),
}));

import {
  describeActiveChatModel,
  getChatProvider,
  getCouncilProviders,
  getEmbeddingProvider,
} from "./model-router";
import { runWithLlmSettings } from "./provider-settings";

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_CHAT_MODEL;
  delete process.env.OPENAI_CHAT_MODEL;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("getChatProvider zonder opgeslagen instelling", () => {
  it("kiest Anthropic zodra die sleutel bestaat — het gedrag van vóór stap 24", () => {
    process.env.ANTHROPIC_API_KEY = "sleutel-a";
    process.env.OPENAI_API_KEY = "sleutel-o";

    expect(getChatProvider().id).toBe("anthropic");
  });

  it("valt terug op OpenAI wanneer alleen die sleutel bestaat", () => {
    process.env.OPENAI_API_KEY = "sleutel-o";

    expect(getChatProvider().id).toBe("openai");
  });

  it("gooit een duidelijke fout wanneer er helemaal geen sleutel is", () => {
    expect(() => getChatProvider()).toThrow("Geen LLM-provider geconfigureerd");
  });
});

describe("getChatProvider met een opgeslagen instelling", () => {
  it("kiest OpenAI terwijl de Anthropic-sleutel gewoon blijft staan", async () => {
    // Dit is de kern van stap 24. Vóór deze stap kon dit alleen door
    // ANTHROPIC_API_KEY te verwijderen — waarmee de Council omviel.
    process.env.ANTHROPIC_API_KEY = "sleutel-a";
    process.env.OPENAI_API_KEY = "sleutel-o";

    await runWithLlmSettings({ chatProvider: "openai" }, async () => {
      expect(getChatProvider().id).toBe("openai");
    });

    // En buiten de wrapper geldt gewoon weer het omgevingsgedrag.
    expect(getChatProvider().id).toBe("anthropic");
  });

  it("kan Anthropic ook dwingend kiezen", async () => {
    process.env.ANTHROPIC_API_KEY = "sleutel-a";
    process.env.OPENAI_API_KEY = "sleutel-o";

    await runWithLlmSettings({ chatProvider: "anthropic" }, async () => {
      expect(getChatProvider().id).toBe("anthropic");
    });
  });

  it("noemt de ontbrekende sleutel wanneer de gekozen provider niet beschikbaar is", async () => {
    process.env.ANTHROPIC_API_KEY = "sleutel-a";

    await runWithLlmSettings({ chatProvider: "openai" }, async () => {
      expect(() => getChatProvider()).toThrow("OPENAI_API_KEY ontbreekt");
    });
  });

  it("geeft een modelnaam uit de instelling door aan de provider", async () => {
    process.env.OPENAI_API_KEY = "sleutel-o";

    await runWithLlmSettings(
      { chatProvider: "openai", chatModel: "gpt-5-mini" },
      async () => {
        expect(
          (getChatProvider() as unknown as { model?: string }).model,
        ).toBe("gpt-5-mini");
      },
    );
  });
});

describe("describeActiveChatModel", () => {
  it("meldt 'omgeving' wanneer er geen instelling actief is", () => {
    process.env.ANTHROPIC_API_KEY = "sleutel-a";

    expect(describeActiveChatModel()).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5",
      source: "omgeving",
    });
  });

  it("meldt 'instelling' wanneer de keuze uit de opgeslagen instelling komt", async () => {
    process.env.ANTHROPIC_API_KEY = "sleutel-a";
    process.env.OPENAI_API_KEY = "sleutel-o";

    await runWithLlmSettings({ chatProvider: "openai" }, async () => {
      expect(describeActiveChatModel()?.source).toBe("instelling");
      expect(describeActiveChatModel()?.provider).toBe("openai");
    });
  });

  it("meldt 'omgeving' bij de keuze 'auto', ook binnen een wrapper", async () => {
    process.env.ANTHROPIC_API_KEY = "sleutel-a";

    // "auto" IS het omgevingsgedrag — dat als "instelling" tonen zou
    // suggereren dat er iets gekozen is wat er niet is.
    await runWithLlmSettings({ chatProvider: "auto" }, async () => {
      expect(describeActiveChatModel()?.source).toBe("omgeving");
    });
  });

  it("geeft null terug wanneer er geen enkele sleutel is", () => {
    expect(describeActiveChatModel()).toBeNull();
  });
});

describe("naburige keuzes blijven ongemoeid", () => {
  it("laat embeddings op OpenAI staan, ook wanneer de chatkeuze Anthropic is", async () => {
    process.env.ANTHROPIC_API_KEY = "sleutel-a";
    process.env.OPENAI_API_KEY = "sleutel-o";

    await runWithLlmSettings({ chatProvider: "anthropic" }, async () => {
      expect(getEmbeddingProvider()).not.toBeNull();
    });
  });

  it("blijft voor de Council beide providers eisen, los van de chatkeuze", async () => {
    process.env.ANTHROPIC_API_KEY = "sleutel-a";
    process.env.OPENAI_API_KEY = "sleutel-o";

    await runWithLlmSettings({ chatProvider: "openai" }, async () => {
      const council = getCouncilProviders();

      expect(council.anthropic.id).toBe("anthropic");
      expect(council.openai.id).toBe("openai");
    });
  });
});
