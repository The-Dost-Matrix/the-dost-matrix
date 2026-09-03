import { estimateCost } from "./pricing";
import type { ChatCompletionResult } from "./types";

/**
 * Telt tokengebruik en geschatte kosten op over meerdere LLM-aanroepen heen
 * binnen één rol-toewijzing. Nodig omdat de Builder-rol (zie
 * builder-runtime.ts) per toewijzing meerdere aanroepen doet (plannen,
 * schrijven per bestand, samenvatten) — zonder dit zou alleen de kosten van
 * de LAATSTE aanroep zichtbaar worden, niet de werkelijke totaalkosten van de
 * hele toewijzing.
 */
export interface UsageTracker {
  /** Voegt het tokengebruik van één voltooide aanroep toe aan het totaal. */
  add(completion: ChatCompletionResult): void;
  /** Huidige totalen — kan meerdere keren tussentijds opgevraagd worden. */
  totals(): { inputTokens: number; outputTokens: number; cost: number };
}

export function createUsageTracker(): UsageTracker {
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;

  return {
    add(completion) {
      // Een provider die geen tokengebruik teruggeeft, telt voor deze
      // aanroep simpelweg mee als €0 — zie de toelichting bij
      // ChatCompletionResult.usage in types.ts. Dit mag nooit een fout
      // gooien: kostenschatting is puur informatief (zie pricing.ts).
      if (!completion.usage) return;

      inputTokens += completion.usage.inputTokens;
      outputTokens += completion.usage.outputTokens;
      cost += estimateCost(completion.model, completion.usage);
    },
    totals() {
      return {
        inputTokens,
        outputTokens,
        cost: Math.round(cost * 10_000) / 10_000,
      };
    },
  };
}
