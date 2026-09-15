import type {
  ChatCompletionResult,
  ChatWithToolsOptions,
  EmbeddingProvider,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
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
/** Zie de toelichting bij DEFAULT_MAX_TOOL_ROUNDS in anthropic-provider.ts. */
const DEFAULT_MAX_TOOL_ROUNDS = 4;

type OpenAiToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAiChoice = {
  message?: {
    content?: string | null;
    tool_calls?: OpenAiToolCall[];
  };
  finish_reason?: string | null;
};

type OpenAiResponse = {
  choices?: OpenAiChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * OpenAI geeft de argumenten als JSON-tekst terug, niet als object. Een model
 * dat daar iets ongeldigs van maakt, hoort geen uitzondering op te leveren:
 * een leeg argumentenobject laat het gereedschap zelf netjes klagen, en die
 * klacht gaat als tekst terug naar het model.
 */
function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createOpenAiProvider(
  apiKey: string,
  model: string = OPENAI_CHAT_MODEL,
): LlmProvider {
  async function postChat(body: Record<string, unknown>): Promise<OpenAiResponse> {
    const response = await providerFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, ...body }),
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

    return (await response.json()) as OpenAiResponse;
  }

  return {
    id: "openai",

    /**
     * Zelfde lus als bij Anthropic, andere vorm. OpenAI wil het eigen
     * assistant-bericht (mét `tool_calls`) teruggestuurd zien, gevolgd door
     * één los `tool`-bericht per aanroep, gekoppeld via `tool_call_id`.
     *
     * De laatste ronde gaat bewust zónder gereedschap de deur uit, zodat het
     * model gedwongen wordt met een echt antwoord te komen in plaats van
     * opnieuw iets op te vragen.
     */
    async chatCompletionWithTools(
      systemPrompt: string,
      messages: LlmMessage[],
      options: ChatWithToolsOptions,
    ): Promise<ChatCompletionResult> {
      const maxRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

      const conversation: Record<string, unknown>[] = [
        { role: "system", content: systemPrompt },
        ...messages.map((message) => ({ role: message.role, content: message.content })),
      ];

      const tools = options.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));

      let inputTokens = 0;
      let outputTokens = 0;

      for (let round = 0; round <= maxRounds; round += 1) {
        const withTools = round < maxRounds;

        const data = await postChat({
          messages: conversation,
          ...(withTools ? { tools } : {}),
        });

        inputTokens += data.usage?.prompt_tokens ?? 0;
        outputTokens += data.usage?.completion_tokens ?? 0;

        const choice = data.choices?.[0];
        const toolCalls = choice?.message?.tool_calls ?? [];

        if (toolCalls.length === 0) {
          const text = choice?.message?.content?.trim() ?? "";
          if (!text) throw new Error("OpenAI gaf een leeg antwoord terug.");

          return {
            content: text,
            model: `openai/${model}`,
            ...(typeof choice?.finish_reason === "string"
              ? { stopReason: choice.finish_reason }
              : {}),
            usage: { inputTokens, outputTokens },
          };
        }

        conversation.push({
          role: "assistant",
          content: choice?.message?.content ?? null,
          tool_calls: toolCalls,
        });

        for (const toolCall of toolCalls) {
          const call: LlmToolCall = {
            id: toolCall.id ?? "",
            name: toolCall.function?.name ?? "",
            arguments: parseToolArguments(toolCall.function?.arguments),
          };

          conversation.push({
            role: "tool",
            tool_call_id: call.id,
            content: await options.runTool(call),
          });
        }
      }

      throw new Error("De gereedschapslus van OpenAI eindigde zonder antwoord.");
    },
    async chatCompletion(
      systemPrompt: string,
      messages: LlmMessage[],
    ): Promise<ChatCompletionResult> {
      // Het aanroepen en de foutafhandeling staan in postChat hierboven,
      // gedeeld met de gereedschapslus.
      const data = await postChat({
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      });

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
