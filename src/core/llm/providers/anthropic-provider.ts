import type { ChatCompletionResult, LlmMessage, LlmProvider } from "@/core/llm/types";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_CHAT_MODEL || "claude-sonnet-5";
const REQUEST_TIMEOUT_MS = 60_000;

export function createAnthropicProvider(apiKey: string): LlmProvider {
  return {
    id: "anthropic",
    async chatCompletion(
      systemPrompt: string,
      messages: LlmMessage[],
    ): Promise<ChatCompletionResult> {
      let response: Response;
      try {
        response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: ANTHROPIC_MODEL,
            max_tokens: 1024,
            system: systemPrompt,
            messages: messages
              .filter((message) => message.role !== "system")
              .map((message) => ({ role: message.role, content: message.content })),
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          cache: "no-store",
        });
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          throw new Error("De AI-provider overschreed de tijdslimiet.");
        }
        throw new Error("De AI-provider is tijdelijk niet bereikbaar.");
      }

      if (!response.ok) {
        console.error("Anthropic chat request failed", response.status);
        throw new Error(`Anthropic-aanroep mislukt met status ${response.status}.`);
      }

      const data = (await response.json()) as {
        content?: { type: string; text?: string }[];
      };
      const text = (data.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n")
        .trim();
      if (!text) throw new Error("Anthropic gaf een leeg antwoord terug.");

      return { content: text, model: `anthropic/${ANTHROPIC_MODEL}` };
    },
  };
}
