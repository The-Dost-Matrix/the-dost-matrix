import {
  ANTHROPIC_DEFAULT_CHAT_MODEL,
  createAnthropicProvider,
} from "@/core/llm/providers/anthropic-provider";
import {
  OPENAI_DEFAULT_CHAT_MODEL,
  createOpenAiEmbeddingProvider,
  createOpenAiProvider,
} from "@/core/llm/providers/openai-provider";
import type { EmbeddingProvider, LlmProvider } from "@/core/llm/types";

/**
 * v0 Model Router.
 *
 * Today this only *selects* a provider based on configured API keys
 * (Anthropic preferred, OpenAI as fallback). The mockup's richer router —
 * per-task routing, cost tracking, standby models — is intentionally
 * v1+ scope; this is the seam it will plug into.
 */
export function getChatProvider(): LlmProvider {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  if (anthropicKey) return createAnthropicProvider(anthropicKey);
  if (openAiKey) return createOpenAiProvider(openAiKey);

  throw new Error(
    "Geen LLM-provider geconfigureerd. Zet ANTHROPIC_API_KEY of OPENAI_API_KEY in .env.local.",
  );
}

/**
 * Welke provider en welk model `getChatProvider()` op dit moment zou kiezen,
 * of null wanneer er geen enkele sleutel is gezet. Volgt exact dezelfde
 * volgorde als hierboven (Anthropic vóór OpenAI) en gebruikt dezelfde
 * standaardmodellen, zodat het Command Center niet iets anders kan tonen dan
 * er werkelijk draait.
 *
 * Let op: de providers lezen hun modelnaam bij het laden van de module, dus
 * na een wijziging in .env.local is een herstart van de dev-server nodig
 * voordat zowel de uitvoering als deze weergave de nieuwe waarde gebruikt.
 */
export function describeActiveChatModel(): { provider: string; model: string } | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: process.env.ANTHROPIC_CHAT_MODEL?.trim() || ANTHROPIC_DEFAULT_CHAT_MODEL,
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      model: process.env.OPENAI_CHAT_MODEL?.trim() || OPENAI_DEFAULT_CHAT_MODEL,
    };
  }

  return null;
}

/**
 * Embeddings currently only via OpenAI (Anthropic has no embeddings API).
 * Returns null when unavailable — callers fall back to keyword retrieval.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const openAiKey = process.env.OPENAI_API_KEY;
  return openAiKey ? createOpenAiEmbeddingProvider(openAiKey) : null;
}

export interface CouncilProviders {
  anthropic: LlmProvider;
  openai: LlmProvider;
}

/**
 * Stap 13 (The Dost Council V1): de raad heeft bewust BEIDE providers
 * tegelijk nodig, ongeacht welke `getChatProvider()` hierboven als "actieve"
 * Director-provider zou kiezen — die geeft er maar één terug (Anthropic vóór
 * OpenAI). Zonder deze eigen selectie zou een raad van twee onopgemerkt
 * kunnen verworden tot twee aanroepen naar hetzelfde model, wat het hele punt
 * van onafhankelijke, oneens-mogen-zijn meningen ondermijnt (zie
 * council-service.ts). Gooit een duidelijke fout wanneer een van de twee
 * sleutels ontbreekt, in plaats van stilzwijgend met één model verder te
 * gaan — een "raad" van één lid is geen raad.
 */
export function getCouncilProviders(): CouncilProviders {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  const missing: string[] = [];
  if (!anthropicKey) missing.push("ANTHROPIC_API_KEY");
  if (!openAiKey) missing.push("OPENAI_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `De Dost Council heeft beide providers nodig, maar ${missing.join(" en ")} ${
        missing.length > 1 ? "ontbreken" : "ontbreekt"
      } in .env.local.`,
    );
  }

  return {
    anthropic: createAnthropicProvider(anthropicKey as string),
    openai: createOpenAiProvider(openAiKey as string),
  };
}
