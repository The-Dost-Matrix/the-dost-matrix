import { adminDb } from "@/core/firebase/admin";

/**
 * Het spoor dat "Claude kijkt mee" mogelijk maakt.
 *
 * Elke aanroep die met de agentsleutel binnenkomt, zet hier een tijdstempel.
 * Het scherm leest dat terug (zie agent-presence.ts voor wat het betekent).
 *
 * WAAROM IN HETZELFDE DOCUMENT ALS DE PROVIDERINSTELLING
 *
 * `ownerSettings/{ownerId}` bestaat al en draagt al één veld per onderwerp.
 * Een eigen collectie voor één tijdstempel zou een tweede plek opleveren die
 * bij elke migratie en elke opruimactie apart onthouden moet worden. Dit is
 * geen instelling maar wel eigenaar-gebonden toestand, en het hoort bij
 * dezelfde eigenaar.
 *
 * WAAROM ALLES HIER FAIL-OPEN IS
 *
 * Dit is een lampje. Een onbereikbare Firestore mag nooit een missie laten
 * mislukken omdat het bolletje niet bijgewerkt kon worden — dezelfde regel als
 * bij de providerinstelling en bij het bewijs van de Director. Schrijven dat
 * mislukt, wordt gelogd en verder genegeerd; lezen dat mislukt, geeft null,
 * en dan zegt het scherm eerlijk dat het niets weet.
 */
const COLLECTION = "ownerSettings";

export async function recordAgentSeen(
  ownerId: string,
  seenAt: Date = new Date(),
): Promise<void> {
  try {
    await adminDb
      .collection(COLLECTION)
      .doc(ownerId)
      .set({ ownerId, agentLastSeenAt: seenAt.toISOString() }, { merge: true });
  } catch (error) {
    console.error("Tijdstempel van de agentsleutel bijwerken is mislukt", {
      ownerId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

export async function getAgentLastSeenAt(ownerId: string): Promise<string | null> {
  try {
    const snapshot = await adminDb.collection(COLLECTION).doc(ownerId).get();

    if (!snapshot.exists) return null;

    const value = snapshot.data()?.agentLastSeenAt;

    return typeof value === "string" ? value : null;
  } catch (error) {
    console.error("Tijdstempel van de agentsleutel ophalen is mislukt", {
      ownerId,
      error: error instanceof Error ? error.message : error,
    });

    return null;
  }
}
