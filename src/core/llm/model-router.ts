import {
  ANTHROPIC_DEFAULT_CHAT_MODEL,
  createAnthropicProvider,
} from "@/core/llm/providers/anthropic-provider";
import {
  OPENAI_DEFAULT_CHAT_MODEL,
  createOpenAiEmbeddingProvider,
  createOpenAiProvider,
} from "@/core/llm/providers/openai-provider";
import { getActiveLlmSettings } from "@/core/llm/provider-settings";
import type { EmbeddingProvider, LlmProvider } from "@/core/llm/types";

/**
 * v0 Model Router.
 *
 * Selecteert een provider. De rijkere router uit de mockup — routeren per
 * taaksoort, kostenbewaking, standby-modellen — is bewust v1+ scope; dit is de
 * naad waar dat later in past.
 *
 * Sinds stap 24 leest de selectie eerst de instelling van de eigenaar (zie
 * provider-settings.ts) en pas daarna de omgevingsvariabelen. Vóór die stap
 * was de omgeving de enige bron, en kwam een lege Anthropic-creditbalans dus
 * neer op: sleutel weghalen in Vercel en opnieuw deployen — waarmee meteen de
 * Dost Council omviel, die beide sleutels tegelijk nodig heeft.
 */

/** Waar de actieve keuze vandaan komt. Zie `describeActiveChatModel`. */
export type ChatProviderSource = "instelling" | "omgeving";

function resolveModelName(
  provider: "anthropic" | "openai",
  override: string | undefined,
): string {
  if (override?.trim()) {
    return override.trim();
  }

  return provider === "anthropic"
    ? process.env.ANTHROPIC_CHAT_MODEL?.trim() || ANTHROPIC_DEFAULT_CHAT_MODEL
    : process.env.OPENAI_CHAT_MODEL?.trim() || OPENAI_DEFAULT_CHAT_MODEL;
}

export function getChatProvider(): LlmProvider {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;
  const settings = getActiveLlmSettings();
  const preference = settings?.chatProvider ?? "auto";

  if (preference === "anthropic") {
    if (!anthropicKey) {
      throw new Error(
        "De providerinstelling staat op Anthropic, maar ANTHROPIC_API_KEY ontbreekt. Kies een andere provider in het Systeemstatus-paneel, of zet de sleutel alsnog.",
      );
    }

    return createAnthropicProvider(
      anthropicKey,
      resolveModelName("anthropic", settings?.chatModel),
    );
  }

  if (preference === "openai") {
    if (!openAiKey) {
      throw new Error(
        "De providerinstelling staat op OpenAI, maar OPENAI_API_KEY ontbreekt. Kies een andere provider in het Systeemstatus-paneel, of zet de sleutel alsnog.",
      );
    }

    return createOpenAiProvider(
      openAiKey,
      resolveModelName("openai", settings?.chatModel),
    );
  }

  // "auto": exact het gedrag van vóór stap 24 — Anthropic wint zodra die
  // sleutel bestaat. Bewust ongewijzigd: een Matrix zonder opgeslagen
  // instelling hoort zich te gedragen zoals hij deed.
  if (anthropicKey) {
    return createAnthropicProvider(
      anthropicKey,
      resolveModelName("anthropic", settings?.chatModel),
    );
  }

  if (openAiKey) {
    return createOpenAiProvider(
      openAiKey,
      resolveModelName("openai", settings?.chatModel),
    );
  }

  throw new Error(
    "Geen LLM-provider geconfigureerd. Zet ANTHROPIC_API_KEY of OPENAI_API_KEY in .env.local.",
  );
}

/**
 * Welke provider en welk model `getChatProvider()` op dit moment zou kiezen,
 * en WAAR die keuze vandaan komt. Null wanneer er geen enkele sleutel is
 * gezet.
 *
 * Dat `source`-veld is sinds stap 24 het vangnet onder de AsyncLocalStorage:
 * draait deze code buiten een `withOwnerLlmSettings`-wrapper, dan staat er
 * "omgeving" in plaats van "instelling". Zie je dat terwijl je wél een keuze
 * hebt opgeslagen, dan mist er ergens een wrapper — zichtbaar, in plaats van
 * dat je je afvraagt waarom je instelling niet aankomt.
 *
 * Let op: de providers lazen hun modelnaam tot deze stap in bij het laden van
 * de module, waardoor een wijziging pas na een herstart aankwam. Dat is nu
 * niet meer zo — de naam wordt per aanroep bepaald.
 */
export function describeActiveChatModel(): {
  provider: string;
  model: string;
  source: ChatProviderSource;
} | null {
  const settings = getActiveLlmSettings();
  const preference = settings?.chatProvider ?? "auto";

  if (preference === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: resolveModelName("anthropic", settings?.chatModel),
      source: "instelling",
    };
  }

  if (preference === "openai" && process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      model: resolveModelName("openai", settings?.chatModel),
      source: "instelling",
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: resolveModelName("anthropic", settings?.chatModel),
      source: "omgeving",
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      model: resolveModelName("openai", settings?.chatModel),
      source: "omgeving",
    };
  }

  return null;
}

/**
 * Embeddings currently only via OpenAI (Anthropic has no embeddings API).
 * Returns null when unavailable — callers fall back to keyword retrieval.
 *
 * Bewust NIET gekoppeld aan de providerinstelling hierboven: die gaat over
 * welk model redeneert, niet over hoe kennis doorzoekbaar wordt gemaakt. Zou
 * de keuze "anthropic" ook embeddings uitschakelen, dan stopte semantisch
 * zoeken stilletjes door een keuze die daar niets mee te maken heeft.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const openAiKey = process.env.OPENAI_API_KEY;
  return openAiKey ? createOpenAiEmbeddingProvider(openAiKey) : null;
}

export interface CouncilProviders {
  anthropic: LlmProvider;
  openai: LlmProvider;
}

/**
 * Stap 13 (The Dost Council V1): de raad heeft bewust BEIDE providers
 * tegelijk nodig, ongeacht welke `getChatProvider()` hierboven als "actieve"
 * Director-provider zou kiezen — die geeft er maar één terug (Anthropic vóór
 * OpenAI). Zonder deze eigen selectie zou een raad van twee onopgemerkt
 * kunnen verworden tot twee aanroepen naar hetzelfde model, wat het hele punt
 * van onafhankelijke, oneens-mogen-zijn meningen ondermijnt (zie
 * council-service.ts). Gooit een duidelijke fout wanneer een van de twee
 * sleutels ontbreekt, in plaats van stilzwijgend met één model verder te
 * gaan — een "raad" van één lid is geen raad.
 *
 * Sinds stap 24 is dat geen reden meer om vast te lopen zodra één provider
 * geen krediet meer heeft. De Director wisselen gaat nu via de instelling, en
 * beide sleutels mogen gewoon blijven staan. Vóór die stap was het weghalen
 * van een sleutel de enige manier om de Director te laten wisselen — en
 * precies dat legde deze raad plat.
 */
export function getCouncilProviders(): CouncilProviders {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  const missing: string[] = [];
  if (!anthropicKey) missing.push("ANTHROPIC_API_KEY");
  if (!openAiKey) missing.push("OPENAI_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `De Dost Council heeft beide providers nodig, maar ${missing.join(" en ")} ${
        missing.length > 1 ? "ontbreken" : "ontbreekt"
      } in .env.local.`,
    );
  }

  return {
    anthropic: createAnthropicProvider(anthropicKey as string),
    openai: createOpenAiProvider(openAiKey as string),
  };
}
