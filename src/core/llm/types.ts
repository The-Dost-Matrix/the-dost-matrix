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

/**
 * GEREEDSCHAP VOOR EEN ROL (stap 18, deel 4)
 *
 * Tot nu toe kon een rol alleen antwoorden met tekst. Wat hij te zien kreeg,
 * bepaalden wij vooraf — en precies dáár ging het op 14 september 2026 mis:
 * de opdracht droeg de Builder op een type te gebruiken uit een bestand dat
 * hij nooit kreeg voorgeschoteld, waarna het model terecht weigerde te gokken.
 * Bewijs dat wij vooraf samenstellen, kan nooit volledig zijn; de rol ontdekt
 * pas tijdens het werk wat hij écht nodig heeft.
 *
 * Met gereedschap mag hij daar zelf om vragen. Dat is een aanvulling en nooit
 * een vervanging: de gedwongen bewijslaag (stap 10 en 12) blijft staan, want
 * de hele winst daarvan is dat het bewijs wordt opgedrongen in plaats van dat
 * we hopen dat het model erom vraagt.
 *
 * WAAROM DE LUS IN DE PROVIDER ZIT
 *
 * Anthropic en OpenAI vragen allebei om iets heel anders: blokken met
 * `tool_use` en `tool_result` tegenover `tool_calls` en losse `tool`-berichten.
 * Zou de aanroeper die lus draaien, dan moest hij beide vormen kennen en zou
 * elke rol die gereedschap wil gebruiken dat werk overdoen. Daarom geeft de
 * aanroeper alleen de gereedschappen en één functie die ze uitvoert; de
 * provider praat net zolang met het model tot er een gewoon tekstantwoord uit
 * komt, en geeft dat terug alsof het een normale aanroep was.
 */
export interface LlmToolDefinition {
  name: string;
  /** Wat het gereedschap doet — dit is wat het model leest om te kiezen. */
  description: string;
  /** JSON Schema van de parameters, zoals beide providers dat verwachten. */
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  /** Identificatie van deze aanroep, nodig om het antwoord terug te koppelen. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Voert één gereedschapsaanroep uit en geeft het resultaat als tekst terug.
 *
 * Gooit bewust niet bij een onbekend of fout gereedschap: een foutmelding als
 * tekst teruggeven laat het model zichzelf corrigeren, terwijl een exception
 * de hele toewijzing zou laten vallen om een vraag die verkeerd gesteld was.
 */
export type LlmToolRunner = (call: LlmToolCall) => Promise<string>;

export interface ChatWithToolsOptions {
  tools: LlmToolDefinition[];
  runTool: LlmToolRunner;
  /**
   * Hoe vaak het model gereedschap mag gebruiken binnen één aanroep. Een
   * bovengrens is geen luxe: elke ronde is een extra modelaanroep, en een
   * model dat blijft zoeken zonder te schrijven kost tijd en geld zonder
   * iets op te leveren.
   */
  maxToolRounds?: number;
}

export interface LlmProvider {
  id: string;
  chatCompletion(
    systemPrompt: string,
    messages: LlmMessage[],
  ): Promise<ChatCompletionResult>;
  /**
   * Optioneel. Ontbreekt deze methode, dan valt de aanroeper terug op
   * `chatCompletion` — precies het gedrag van vóór stap 18 (deel 4). Zo kan
   * gereedschap per provider aan gezet worden zonder dat er iets breekt bij
   * een provider die het (nog) niet kan.
   */
  chatCompletionWithTools?(
    systemPrompt: string,
    messages: LlmMessage[],
    options: ChatWithToolsOptions,
  ): Promise<ChatCompletionResult>;
}

export interface EmbeddingProvider {
  id: string;
  embed(text: string): Promise<number[]>;
}
