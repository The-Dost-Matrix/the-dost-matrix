export interface LlmMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  /** e.g. "anthropic/claude-sonnet-5" or "openai/gpt-5" — stored on de message voor traceerbaarheid. */
  model: string;
  /**
   * Waarom het model stopte met genereren (bv. Anthropic's "end_turn",
   * "max_tokens", "stop_sequence"). Optioneel omdat niet elke provider dit
   * teruggeeft. Cruciaal voor diagnose: als een aanroep geen bruikbaar
   * antwoord teruggeeft, vertelt dit veld ONS of dat kwam doordat het
   * antwoord echt is afgekapt door het tokenplafond ("max_tokens") — dan
   * moet het plafond omhoog — of doordat het model zelf stopte met een
   * verkeerd geformatteerd antwoord ("end_turn") — dan is het een
   * prompt/parsing-probleem, geen tokenprobleem. Zonder dit veld moeten we
   * daartussen gissen; zie builder-runtime.ts's writeSingleFile().
   */
  stopReason?: string;
  /**
   * Daadwerkelijk tokengebruik van deze ene aanroep, zoals de provider dat
   * teruggeeft — gebruikt door mission-engine/v2/pricing.ts om een
   * kostenschatting te maken (zie usage-tracker.ts). Optioneel: als een
   * provider dit niet teruggeeft, telt deze aanroep simpelweg voor €0 mee in
   * plaats van dat er iets crasht — kostenschatting is bewust puur
   * informatief (zie mission.ts) en mag nooit een missie blokkeren.
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
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
