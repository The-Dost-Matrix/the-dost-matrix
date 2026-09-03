/**
 * Ruwe kostenschatting per LLM-aanroep, voor de "zichtbaar, nooit blokkerend"
 * budget-weergave in Mission Engine V2 (zie mission.ts en
 * mission-engine-v2-panel.tsx). De eigenaar heeft expliciet gekozen dat een
 * missie NOOIT mag stoppen of falen vanwege kosten — dit bestand bestaat dus
 * uitsluitend om iets zinnigs te kunnen tónen, niet om iets te handhaven.
 *
 * Prijzen zijn bewust benaderend: dit zijn de officiële lijstprijzen (in USD
 * per 1 miljoen tokens) ten tijde van bouwen, hardcoded omdat geen van de
 * providers hier een prijzen-API voor aanbiedt. Ze kunnen na verloop van tijd
 * afwijken van de daadwerkelijke, actuele prijzen. Omdat dit uitsluitend
 * informatief is (zie hierboven), heeft een verouderde prijs geen enkel
 * operationeel risico — in het ergste geval toont de UI een iets onnauwkeurig
 * bedrag, nooit een verkeerd blokkerende beslissing.
 *
 * Ook bewust GEEN valuta-omrekening naar het budget van een missie (dat staat
 * standaard in EUR, zie mission-factory.ts): kostenschattingen worden hier
 * altijd in USD berekend en ook zo getoond (zie de UI), in plaats van een
 * schijnnauwkeurige EUR-omrekening te doen op basis van een wisselkoers die
 * ook weer zou verouderen.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ModelPricing {
  /** USD per 1 miljoen inputtokens. */
  inputPerMillion: number;
  /** USD per 1 miljoen outputtokens. */
  outputPerMillion: number;
}

// Sleutels komen overeen met het "model"-veld dat de providers teruggeven
// (zie anthropic-provider.ts / openai-provider.ts), bv. "anthropic/claude-sonnet-5".
const PRICING_BY_MODEL: Readonly<Record<string, ModelPricing>> = {
  "anthropic/claude-sonnet-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "openai/gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
};

// Gebruikt voor een onbekend/nieuw modelnaam (bv. na een env-var wijziging)
// zodat kostenschatting nooit hard faalt op een ontbrekende prijs — een
// redelijke, gemiddelde inschatting in plaats van een crash of een stille 0.
const FALLBACK_PRICING: ModelPricing = { inputPerMillion: 3, outputPerMillion: 15 };

/**
 * Schat de kosten (in USD) van één LLM-aanroep op basis van het
 * daadwerkelijke tokengebruik dat de provider teruggaf. Geeft nooit een
 * foutmelding — een onbekend model valt terug op FALLBACK_PRICING.
 */
export function estimateCost(model: string, usage: TokenUsage): number {
  const pricing = PRICING_BY_MODEL[model] ?? FALLBACK_PRICING;

  const cost =
    (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;

  // Afgerond op 4 decimalen — genoeg precisie voor de kleine bedragen die
  // hier normaal voorkomen, zonder eindeloze drijvendekomma-staarten in de UI.
  return Math.round(cost * 10_000) / 10_000;
}
