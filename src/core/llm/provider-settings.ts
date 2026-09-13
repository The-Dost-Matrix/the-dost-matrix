import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Stap 24 — LLM-provider request-scoped maken, écht in-app wisselbaar.
 *
 * Het probleem dat deze stap oplost, is op 13 september 2026 live opgetreden.
 * De Anthropic-credits raakten op, waarna elke LLM-aanroep faalde met status
 * 400. Omschakelen naar OpenAI kostte toen: inloggen op Vercel, de
 * `ANTHROPIC_API_KEY` uit de omgevingsvariabelen halen, en opnieuw
 * deployen. En dat weghalen brak meteen iets anders, want de Dost Council
 * eist beide sleutels tegelijk (`getCouncilProviders`) — een raad van één lid
 * is geen raad. Er was dus geen enkele manier om alleen de Director van
 * provider te wisselen.
 *
 * De oorzaak zit in `getChatProvider()` in model-router.ts: die kiest
 * Anthropic zodra `ANTHROPIC_API_KEY` BESTÁÁT, ongeacht of er nog krediet op
 * zit, en leest die keuze uitsluitend uit de omgeving. De enige manier om die
 * keuze te veranderen was dus de omgeving veranderen.
 *
 * **Waarom dit bestand een AsyncLocalStorage gebruikt en geen extra parameter
 * op elke aanroep.** `getChatProvider()` wordt op achttien plekken aangeroepen
 * (builder-runtime, director-runtime, qa-runtime, role-runtime, reviewer,
 * chat-service, automated-signoff, mission-knowledge, de knowledge-import, en
 * de drie builder-hulpmodules). De keuze als parameter doorgeven zou betekenen
 * dat achttien aanroepplekken plus alles wat daar weer omheen zit een
 * eigenaar/context moet doorgeven, in één wijziging — veel code die verandert
 * zonder dat er iets aan gedrag wijzigt, en dus veel plek om per ongeluk iets
 * te breken.
 *
 * Node's AsyncLocalStorage is precies gemaakt voor dit soort
 * request-gebonden context: de routehandler zet de keuze één keer neer, en
 * alles wat binnen die aanroep gebeurt — hoe diep ook — leest dezelfde waarde.
 * Geen enkele bestaande aanroepplek hoeft te veranderen. Dat werkt hier omdat
 * alle betrokken routes `runtime = "nodejs"` declareren; op de edge-runtime
 * zou dit niet bestaan.
 *
 * **De prijs die daarbij hoort, en hoe die betaald wordt.** Een
 * AsyncLocalStorage heeft één vervelende faalstand: vergeet je ergens de
 * wrapper, dan valt die code stil terug op het oude omgevingsgedrag en vraag
 * je je af waarom je instelling niet aankomt. Precies het soort stille fout
 * dat dit project elders juist probeert uit te bannen. Daarom rapporteert
 * `describeActiveChatModel()` (model-router.ts) sinds deze stap ook WAAR de
 * keuze vandaan komt — instelling of omgeving — en toont het
 * Systeemstatus-paneel dat. Komt er ergens "omgeving" te staan waar je een
 * instelling verwacht, dan mist daar een wrapper, en dat is zichtbaar in
 * plaats van raadselachtig.
 *
 * Bewust NIET gebouwd: automatisch terugvallen op de andere provider zodra er
 * één faalt. Dat klinkt behulpzaam, maar het betekent dat een missie halverwege
 * stilletjes op een ander model verdergaat dan waarmee hij begon, en dat het
 * bewijs achteraf niet meer uitlegt waarom een stap anders uitpakte dan de
 * vorige. Dezelfde afweging als bij "eerlijke twijfel" elders in dit project:
 * liever een duidelijke fout die je kunt zien, dan een stille redding die je
 * niet kunt navertellen. De foutmelding bij een lege creditbalans is in plaats
 * daarvan leesbaar gemaakt (zie de providers), zodat één blik volstaat om te
 * weten dat je moet omschakelen.
 */

/**
 * - "auto": gedrag van vóór deze stap — Anthropic wanneer die sleutel bestaat,
 *   anders OpenAI. Blijft de standaard, zodat een Matrix zonder opgeslagen
 *   instelling zich precies gedraagt zoals hij deed.
 * - "anthropic" / "openai": dwingend. De andere sleutel mag gewoon blijven
 *   staan — dat is het hele punt. Zo kun je de Director op OpenAI zetten
 *   terwijl de Council beide providers houdt en gewoon blijft werken.
 */
export type ChatProviderPreference = "auto" | "anthropic" | "openai";

export interface OwnerLlmSettings {
  chatProvider: ChatProviderPreference;
  /**
   * Modelnaam die de gekozen provider moet gebruiken. Leeg laten betekent: het
   * standaardmodel van die provider (of wat er in `ANTHROPIC_CHAT_MODEL` /
   * `OPENAI_CHAT_MODEL` staat). Tot deze stap werd die modelnaam ingelezen bij
   * het laden van de module, waardoor hij pas na een herstart veranderde; via
   * deze instelling geldt hij per aanroep.
   */
  chatModel?: string;
}

export const DEFAULT_OWNER_LLM_SETTINGS: OwnerLlmSettings = {
  chatProvider: "auto",
};

const CHAT_PROVIDER_PREFERENCES: ChatProviderPreference[] = [
  "auto",
  "anthropic",
  "openai",
];

export function isChatProviderPreference(
  value: unknown,
): value is ChatProviderPreference {
  return (
    typeof value === "string" &&
    CHAT_PROVIDER_PREFERENCES.includes(value as ChatProviderPreference)
  );
}

/**
 * Maakt van willekeurige opgeslagen of ingestuurde data een geldige instelling.
 * Onbekende waarden vallen terug op "auto" in plaats van een fout te gooien:
 * een onleesbare instelling mag nooit betekenen dat de Matrix helemaal geen
 * provider meer kan kiezen.
 */
export function normalizeOwnerLlmSettings(value: unknown): OwnerLlmSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_OWNER_LLM_SETTINGS;
  }

  const candidate = value as Record<string, unknown>;

  const chatProvider = isChatProviderPreference(candidate.chatProvider)
    ? candidate.chatProvider
    : "auto";

  const chatModel =
    typeof candidate.chatModel === "string" && candidate.chatModel.trim()
      ? candidate.chatModel.trim().slice(0, 120)
      : undefined;

  return chatModel ? { chatProvider, chatModel } : { chatProvider };
}

const storage = new AsyncLocalStorage<OwnerLlmSettings>();

/**
 * Voert `fn` uit met deze instellingen als de actieve keuze. Alles wat binnen
 * die aanroep een provider opvraagt — hoe diep in de aanroepketen ook — krijgt
 * deze keuze te zien.
 */
export function runWithLlmSettings<T>(
  settings: OwnerLlmSettings,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(settings, fn);
}

/**
 * De actieve instelling, of null wanneer deze code niet binnen
 * `runWithLlmSettings` draait. Null betekent: val terug op de omgeving, precies
 * zoals vóór deze stap.
 */
export function getActiveLlmSettings(): OwnerLlmSettings | null {
  return storage.getStore() ?? null;
}
