import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/core/firebase/admin";
import {
  DEFAULT_OWNER_LLM_SETTINGS,
  normalizeOwnerLlmSettings,
  runWithLlmSettings,
  type OwnerLlmSettings,
} from "@/core/llm/provider-settings";

/**
 * Stap 24 — opslag van de providerkeuze.
 *
 * Firestore en niet een omgevingsvariabele, om precies één reden: een
 * omgevingsvariabele veranderen vraagt op Vercel een nieuwe deployment, en dat
 * is nu juist de omweg die deze stap weghaalt. Een document dat je vanuit de
 * app schrijft, werkt bij de eerstvolgende aanroep.
 *
 * Eén document per eigenaar, ook al is dit systeem bewust een
 * één-eigenaar-systeem (zie ADR-001-ONE_OWNER): de owner-isolatie die overal
 * elders in dit project geldt, doorbreken voor een enkel instellingenveld zou
 * een uitzondering maken die later stilletjes de norm wordt.
 */
const COLLECTION = "ownerSettings";

export async function getOwnerLlmSettings(
  ownerId: string,
): Promise<OwnerLlmSettings> {
  try {
    const snapshot = await adminDb.collection(COLLECTION).doc(ownerId).get();

    if (!snapshot.exists) {
      return DEFAULT_OWNER_LLM_SETTINGS;
    }

    return normalizeOwnerLlmSettings(snapshot.data()?.llm);
  } catch (error) {
    // Fail-open, net als bij het bewijs van de Director (stap 17): een
    // onbereikbare Firestore mag niet betekenen dat er geen enkele provider
    // meer gekozen kan worden. Dan maar terug naar het omgevingsgedrag van
    // vóór deze stap, dat sowieso altijd werkt.
    console.error("Providerinstelling ophalen is mislukt", {
      ownerId,
      error: error instanceof Error ? error.message : error,
    });

    return DEFAULT_OWNER_LLM_SETTINGS;
  }
}

export async function saveOwnerLlmSettings(
  ownerId: string,
  settings: OwnerLlmSettings,
): Promise<OwnerLlmSettings> {
  const normalized = normalizeOwnerLlmSettings(settings);

  await adminDb
    .collection(COLLECTION)
    .doc(ownerId)
    .set(
      {
        ownerId,
        llm: {
          chatProvider: normalized.chatProvider,
          // Expliciet null in plaats van het veld weglaten: een `set` met
          // merge laat een weggelaten veld ongemoeid, waardoor een eerder
          // ingesteld model niet meer te wissen zou zijn.
          chatModel: normalized.chatModel ?? null,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  return normalized;
}

/**
 * Laadt de providerkeuze van deze eigenaar en voert `fn` daarbinnen uit.
 *
 * Dit is de wrapper die routehandlers om hun werk heen zetten. Vergeet je hem,
 * dan valt die route terug op het omgevingsgedrag — zichtbaar in het
 * Systeemstatus-paneel, dat sinds deze stap ook toont waar de actieve keuze
 * vandaan komt (zie de toelichting in provider-settings.ts).
 *
 * Doet één Firestore-leesactie per verzoek, niet per LLM-aanroep: een missie
 * die tien modelaanroepen doet, leest de instelling één keer.
 */
export async function withOwnerLlmSettings<T>(
  ownerId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const settings = await getOwnerLlmSettings(ownerId);

  return runWithLlmSettings(settings, fn);
}
