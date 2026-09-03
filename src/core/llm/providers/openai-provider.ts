import type {
  ChatCompletionResult,
  EmbeddingProvider,
  LlmMessage,
  LlmProvider,
} from "@/core/llm/types";

const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o";
const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const REQUEST_TIMEOUT_MS = 60_000;

async function providerFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("De AI-provider overschreed de tijdslimiet.");
    }
    throw new Error("De AI-provider is tijdelijk niet bereikbaar.");
  }
}

export function createOpenAiProvider(apiKey: string): LlmProvider {
  return {
    id: "openai",
    async chatCompletion(
      systemPrompt: string,
      messages: LlmMessage[],
    ): Promise<ChatCompletionResult> {
      const response = await providerFetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_CHAT_MODEL,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
      
        console.error("OpenAI chat request failed", {
          status: response.status,
          body: errorText,
        });
      
        throw new Error(
          `OpenAI ${response.status}: ${errorText}`,
        );
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) throw new Error("OpenAI gaf een leeg antwoord terug.");

      return {
        content: text,
        model: `openai/${OPENAI_CHAT_MODEL}`,
        usage:
          typeof data.usage?.prompt_tokens === "number" &&
          typeof data.usage?.completion_tokens === "number"
            ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
            : undefined,
      };
    },
  };
}

export function createOpenAiEmbeddingProvider(apiKey: string): EmbeddingProvider {
  return {
    id: "openai-embeddings",
    async embed(text: string): Promise<number[]> {
      const response = await providerFetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: text }),
      });

      if (!response.ok) {
        const errorText = await response.text();
      
        console.error("OpenAI embedding request failed", {
          status: response.status,
          body: errorText,
        });
      
        return [];
      }

      const data = (await response.json()) as {
        data?: { embedding?: number[] }[];
      };
      return data.data?.[0]?.embedding ?? [];
    },
  };
}
