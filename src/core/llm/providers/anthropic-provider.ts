import type { ChatCompletionResult, LlmMessage, LlmProvider } from "@/core/llm/types";

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

export function createAnthropicProvider(
  apiKey: string,
  model: string = ANTHROPIC_MODEL,
): LlmProvider {
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
            model,
            max_tokens: MAX_OUTPUT_TOKENS,
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
        // Het antwoord van Anthropic zelf meelezen: daar staat het verschil
        // tussen "je tegoed is op" en "je sleutel klopt niet" in, en zonder
        // dat is elke fout hier dezelfde nietszeggende statuscode.
        const body = await response.text().catch(() => "");

        console.error("Anthropic chat request failed", {
          status: response.status,
          model,
          body,
        });

        throw new Error(describeAnthropicFailure(response.status, body));
      }

      const data = (await response.json()) as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (data.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n")
        .trim();
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
