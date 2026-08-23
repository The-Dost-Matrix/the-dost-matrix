export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  /** e.g. "anthropic/claude-sonnet-5" or "openai/gpt-5" — stored on the message for traceability. */
  model: string;
}

export interface LlmProvider {
  id: string;
  chatCompletion(
    systemPrompt: string,
    messages: LlmMessage[],
  ): Promise<ChatCompletionResult>;
}

export interface EmbeddingProvider {
  id: string;
  embed(text: string): Promise<number[]>;
}
