import { createAnthropicProvider } from "@/core/llm/providers/anthropic-provider";
import {
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
 * Embeddings currently only via OpenAI (Anthropic has no embeddings API).
 * Returns null when unavailable — callers fall back to keyword retrieval.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const openAiKey = process.env.OPENAI_API_KEY;
  return openAiKey ? createOpenAiEmbeddingProvider(openAiKey) : null;
}
