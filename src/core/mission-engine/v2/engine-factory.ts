import { randomUUID } from "node:crypto";

import { MissionEngine, type MissionClock, type MissionIdFactory } from "./engine";
import { FirestoreMissionEngineStore } from "./firestore-store";

/**
 * Systeemklok die echte kloktijd teruggeeft als ISO-datum — de MissionEngine
 * zelf blijft klok-agnostisch (zie verification.ts, dat een vaste testklok
 * gebruikt), maar buiten tests hoort dit de enige plek te zijn waar we
 * `new Date()` aanroepen voor de engine.
 */
const systemClock: MissionClock = {
  now: () => new Date().toISOString(),
};

const systemIdFactory: MissionIdFactory = {
  nextId: (prefix) => `${prefix}_${randomUUID()}`,
};

let sharedEngine: MissionEngine | null = null;

/**
 * Geeft een MissionEngine terug die persistent opslaat via Firestore
 * (FirestoreMissionEngineStore). Server-only — gebruikt de Firebase Admin
 * SDK, dus alleen aanroepen vanuit API-routes of andere server-code, nooit
 * vanuit client-componenten.
 *
 * Eén gedeelde instantie per proces is voldoende: de engine zelf houdt geen
 * mission-state in het geheugen bij (alles gaat via de store), dus hergebruik
 * is puur een kleine optimalisatie.
 */
export function createMissionEngineV2(): MissionEngine {
  if (!sharedEngine) {
    sharedEngine = new MissionEngine(
      new FirestoreMissionEngineStore(),
      systemClock,
      systemIdFactory,
    );
  }

  return sharedEngine;
}

export function nextMissionEngineV2Id(prefix: string): string {
  return systemIdFactory.nextId(prefix);
}

export function missionEngineV2Now(): string {
  return systemClock.now();
}
