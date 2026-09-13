import type {
  ChatCompletionResult,
  EmbeddingProvider,
  LlmMessage,
  LlmProvider,
} from "@/core/llm/types";

/** Zie de toelichting bij ANTHROPIC_DEFAULT_CHAT_MODEL. */
export const OPENAI_DEFAULT_CHAT_MODEL = "gpt-4o";

const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || OPENAI_DEFAULT_CHAT_MODEL;
const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Zelfde bedoeling als `describeAnthropicFailure`: een melding waar je iets
 * aan hebt in plaats van een kale statuscode met een stuk ruwe JSON erachter.
 * Het onderscheid dat er in de praktijk toe doet is "tegoed op" versus
 * "sleutel klopt niet" versus "even te snel".
 */
function describeOpenAiFailure(status: number, body: string): string {
  const lowered = body.toLowerCase();

  if (
    lowered.includes("insufficient_quota") ||
    lowered.includes("exceeded your current quota") ||
    lowered.includes("billing")
  ) {
    return `OpenAI weigert de aanroep: het tegoed van je OpenAI-account is op (status ${status}). Vul credits bij, of zet de provider in het Systeemstatus-paneel op Anthropic.`;
  }

  if (status === 401 || status === 403) {
    return `OpenAI accepteert de API-sleutel niet (status ${status}). Controleer OPENAI_API_KEY.`;
  }

  if (status === 429) {
    return "OpenAI limiteert het aantal aanroepen op dit moment (status 429). Probeer het zo opnieuw, of schakel tijdelijk over op Anthropic.";
  }

  return `OpenAI-aanroep mislukt met status ${status}: ${body.slice(0, 300)}`;
}

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

/**
 * `model` is sinds stap 24 een parameter: de model-router bepaalt de naam per
 * aanroep (uit de instelling van de eigenaar), in plaats van dat hij hier één
 * keer bij het laden van de module wordt ingelezen. De constante blijft de
 * fallback voor aanroepers die niets meegeven, zoals `getCouncilProviders`.
 */
export function createOpenAiProvider(
  apiKey: string,
  model: string = OPENAI_CHAT_MODEL,
): LlmProvider {
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
          model,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();

        console.error("OpenAI chat request failed", {
          status: response.status,
          model,
          body: errorText,
        });

        throw new Error(describeOpenAiFailure(response.status, errorText));
      }

      const data = (await response.json()) as {
        choices?: {
          message?: { content?: string | null };
          finish_reason?: string | null;
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) throw new Error("OpenAI gaf een leeg antwoord terug.");

      // OpenAI's finish_reason is hetzelfde signaal als Anthropic's
      // stop_reason: "length" betekent afgekapt door het tokenplafond,
      // "stop" betekent dat het model zelf klaar was. Dit ontbrak hier,
      // waardoor een afgekapt antwoord bij deze provider niet te
      // onderscheiden was van een model dat gewoon geen JSON schreef — zie
      // de toelichting bij ChatCompletionResult in core/llm/types.ts en de
      // foutmelding in director-runtime.ts die dit veld gebruikt.
      const finishReason = data.choices?.[0]?.finish_reason;

      return {
        content: text,
        model: `openai/${model}`,
        ...(typeof finishReason === "string" ? { stopReason: finishReason } : {}),
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
