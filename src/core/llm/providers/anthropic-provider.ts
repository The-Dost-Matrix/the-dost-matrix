import type {
  ChatCompletionResult,
  ChatWithToolsOptions,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
} from "@/core/llm/types";

/**
 * Geëxporteerd zodat de systeemstatus in het Command Center hetzelfde
 * standaardmodel kan tonen als hier daadwerkelijk wordt gebruikt, zonder die
 * waarde te dupliceren (en dus te laten verouderen).
 */
export const ANTHROPIC_DEFAULT_CHAT_MODEL = "claude-sonnet-5";

/**
 * Fallback voor aanroepers die geen modelnaam meegeven (bijvoorbeeld
 * `getCouncilProviders`). Sinds stap 24 bepaalt de model-router de naam per
 * aanroep en geeft hij hem door; tot die stap werd deze constante één keer bij
 * het laden van de module ingelezen, waardoor een gewijzigde
 * `ANTHROPIC_CHAT_MODEL` pas na een herstart aankwam.
 */
const ANTHROPIC_MODEL = process.env.ANTHROPIC_CHAT_MODEL || ANTHROPIC_DEFAULT_CHAT_MODEL;

/**
 * Vertaalt een mislukte aanroep naar een melding waar je iets aan hebt.
 *
 * Aanleiding: op 13 september 2026 stond er negen uur lang niets anders dan
 * "Anthropic-aanroep mislukt met status 400." Dat die 400 betekende dat de
 * credits op waren, stond wél in het antwoord van Anthropic zelf, maar werd
 * weggegooid. De missie bleef al die tijd hangen zonder dat iemand kon zien
 * waarom.
 */
function describeAnthropicFailure(status: number, body: string): string {
  const lowered = body.toLowerCase();

  if (lowered.includes("credit balance") || lowered.includes("billing")) {
    return `Anthropic weigert de aanroep: het tegoed van je Anthropic-account is op (status ${status}). Vul credits bij, of zet de provider in het Systeemstatus-paneel op OpenAI.`;
  }

  if (status === 401 || status === 403) {
    return `Anthropic accepteert de API-sleutel niet (status ${status}). Controleer ANTHROPIC_API_KEY.`;
  }

  if (status === 429) {
    return "Anthropic limiteert het aantal aanroepen op dit moment (status 429). Probeer het zo opnieuw, of schakel tijdelijk over op OpenAI.";
  }

  return `Anthropic-aanroep mislukt met status ${status}.`;
}
// Ruim genoeg om een volledig, groot bestand te laten genereren (zie
// MAX_OUTPUT_TOKENS hieronder) — 60s en later 180s bleken in de praktijk nog
// te krap zodra een bestaand bestand (zoals globals.css, ~38KB) helemaal
// opnieuw moest worden teruggegeven. 5 minuten geeft ruim de tijd om het
// hogere tokenplafond ook echt te benutten, zonder dat de eigenaar dit
// telkens verder handmatig hoeft op te hogen.
const REQUEST_TIMEOUT_MS = 300_000;
// Bewust ruim: dit moet ook de volledige, nieuwe inhoud van hele bestanden
// (zoals bij de builder-rol, zie builder-runtime.ts) in één keer kunnen
// teruggeven — sinds builder-runtime.ts per bestand een eigen aanroep doet,
// geldt dit plafond per bestand, niet meer gedeeld over alle bestanden in
// een toewijzing. 1024 (de allereerste waarde) en later 8192 tokens bleken
// beide toch weer te krap zodra een bestaand bestand van een paar tientallen
// kilobytes (zoals globals.css) volledig herschreven moest worden — 8192
// tokens is voor CSS/code al bij zo'n 25-30KB niet meer genoeg. Volgens de
// officiële Anthropic-documentatie (platform.claude.com/docs) ondersteunt
// claude-sonnet-5 via de gewone (niet-Batch) Messages API tot 128.000
// outputtokens, zonder aparte beta-header. 64.000 geeft hier ruim de marge
// voor zelfs grote bestaande bestanden, terwijl er nog altijd veel
// headroom overblijft onder het echte plafond van het model. Anthropic
// rekent alleen af per daadwerkelijk gegenereerd token, dus een hoger
// plafond kost niets extra bij kortere antwoorden.
const MAX_OUTPUT_TOKENS = 64_000;

/** Standaard aantal gereedschapsrondes binnen één aanroep. Zie ChatWithToolsOptions. */
const DEFAULT_MAX_TOOL_ROUNDS = 4;

/** Eén blok in een Anthropic-bericht: tekst, een gereedschapsaanroep, of een resultaat. */
type AnthropicBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
};

type AnthropicMessage = { role: "user" | "assistant"; content: string | AnthropicBlock[] };

type AnthropicResponse = {
  content?: AnthropicBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

function anthropicText(data: AnthropicResponse): string {
  return (data.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

export function createAnthropicProvider(
  apiKey: string,
  model: string = ANTHROPIC_MODEL,
): LlmProvider {
  /**
   * Eén HTTP-aanroep naar de Messages API. Gedeeld door de gewone aanroep en
   * de gereedschapslus, zodat de foutafhandeling (en dus de leesbare melding
   * bij een leeg tegoed) maar op één plek staat.
   */
  async function postMessages(body: Record<string, unknown>): Promise<AnthropicResponse> {
    let response: Response;

    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model, max_tokens: MAX_OUTPUT_TOKENS, ...body }),
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
      const errorBody = await response.text().catch(() => "");

      console.error("Anthropic chat request failed", {
        status: response.status,
        model,
        body: errorBody,
      });

      throw new Error(describeAnthropicFailure(response.status, errorBody));
    }

    return (await response.json()) as AnthropicResponse;
  }

  return {
    id: "anthropic",

    /**
     * Gereedschapslus (stap 18, deel 4).
     *
     * Zolang het model om gereedschap vraagt, wordt zijn eigen antwoord
     * teruggegeven als `assistant`-bericht en komen de resultaten er als
     * `tool_result`-blokken achteraan. Dat is wat Anthropic verwacht: het
     * model moet zijn eigen aanroep terugzien om het resultaat eraan te
     * kunnen koppelen.
     *
     * Raakt het rondeplafond op, dan wordt er nog één keer gevraagd zónder
     * gereedschap. Zo eindigt de lus altijd met een echt antwoord in plaats
     * van met een half gesprek.
     */
    async chatCompletionWithTools(
      systemPrompt: string,
      messages: LlmMessage[],
      options: ChatWithToolsOptions,
    ): Promise<ChatCompletionResult> {
      const maxRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

      const conversation: AnthropicMessage[] = messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
        }));

      const tools = options.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));

      let inputTokens = 0;
      let outputTokens = 0;

      for (let round = 0; round <= maxRounds; round += 1) {
        const withTools = round < maxRounds;

        const data = await postMessages({
          system: systemPrompt,
          messages: conversation,
          ...(withTools ? { tools } : {}),
        });

        inputTokens += data.usage?.input_tokens ?? 0;
        outputTokens += data.usage?.output_tokens ?? 0;

        const toolUses = (data.content ?? []).filter((block) => block.type === "tool_use");

        if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
          const text = anthropicText(data);
          if (!text) throw new Error("Anthropic gaf een leeg antwoord terug.");

          return {
            content: text,
            model: `anthropic/${model}`,
            stopReason: data.stop_reason,
            usage: { inputTokens, outputTokens },
          };
        }

        conversation.push({ role: "assistant", content: data.content ?? [] });

        const results: AnthropicBlock[] = [];

        for (const use of toolUses) {
          const call: LlmToolCall = {
            id: use.id ?? "",
            name: use.name ?? "",
            arguments: use.input ?? {},
          };

          results.push({
            type: "tool_result",
            // `tool_use_id` en `content` staan niet in AnthropicBlock omdat
            // ze alleen hier voorkomen; de cast houdt de rest van het type
            // strak zonder er velden aan te hangen die nergens anders bestaan.
            ...({ tool_use_id: call.id, content: await options.runTool(call) } as object),
          });
        }

        conversation.push({ role: "user", content: results });
      }

      throw new Error("De gereedschapslus van Anthropic eindigde zonder antwoord.");
    },
    async chatCompletion(
      systemPrompt: string,
      messages: LlmMessage[],
    ): Promise<ChatCompletionResult> {
      // Het aanroepen zelf staat in postMessages hierboven — daar zit ook de
      // foutafhandeling die het antwoord van Anthropic meeleest, zodat "je
      // tegoed is op" niet als een kale statuscode eindigt.
      const data = await postMessages({
        system: systemPrompt,
        messages: messages
          .filter((message) => message.role !== "system")
          .map((message) => ({ role: message.role, content: message.content })),
      });

      const text = anthropicText(data);
      if (!text) throw new Error("Anthropic gaf een leeg antwoord terug.");

      // Zichtbaar in de terminal van "npm run dev" — dit is het definitieve
      // bewijs of een onvolledig antwoord kwam door het tokenplafond
      // (stop_reason "max_tokens") of door iets anders (het model stopte
      // zelf, stop_reason "end_turn", met een verkeerd geformatteerd
      // antwoord). Zonder dit loggen moeten builder-runtime.ts en wijzelf
      // daarnaar gissen.
      if (data.stop_reason === "max_tokens") {
        console.warn(
          `Anthropic-antwoord afgekapt door het tokenplafond (max_tokens=${MAX_OUTPUT_TOKENS}). Ontvangen lengte: ${text.length} tekens.`,
        );
      }

      return {
        content: text,
        model: `anthropic/${model}`,
        stopReason: data.stop_reason,
        usage:
          typeof data.usage?.input_tokens === "number" &&
          typeof data.usage?.output_tokens === "number"
            ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
            : undefined,
      };
    },
  };
}
