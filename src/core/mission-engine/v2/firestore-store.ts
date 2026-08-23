import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/core/firebase/admin";

import type { DomainEventEnvelope, EntityId } from "@/core/contracts/v2";
import type { MissionEventPayload } from "./events";
import type { MissionV2 } from "./mission";
import {
  DuplicateCommandError,
  MissionNotFoundError,
  MissionVersionConflictError,
  type MissionEngineStore,
  type MissionMutation,
} from "./store";

/**
 * Firestore-backed implementation van de MissionEngineStore.
 *
 * Ontworpen naar hetzelfde patroon als de bestaande repositories
 * (zie knowledge-repository.ts): server-only, via de Firebase Admin SDK
 * (`adminDb`), nooit via de client-SDK.
 *
 * Collecties:
 * - missionEngineV2Missions — één document per mission (volledige MissionV2-snapshot)
 * - missionEngineV2Commands — één document per verwerkt commandId (idempotentie)
 * - missionEngineV2Outbox   — één document per gepubliceerd domain event
 *
 * commitCreate/commitUpdate draaien in een Firestore-transactie zodat de
 * idempotentie-check, de versie-check en de schrijfacties (mission + command
 * + outbox-event) atomisch gebeuren — dit is wat de MissionEngine als
 * optimistic-concurrency garantie verwacht van zijn store.
 */

const MISSIONS_COLLECTION = "missionEngineV2Missions";
const COMMANDS_COLLECTION = "missionEngineV2Commands";
const OUTBOX_COLLECTION = "missionEngineV2Outbox";

/**
 * Firestore accepteert geen `undefined`-waarden in documenten. De MissionEngine
 * zet af en toe expliciet `undefined` in payloads (bv. `reason: x ?? undefined`).
 * Deze helper verwijdert die velden recursief vóór het schrijven, zodat we
 * nooit een cryptische Firestore-fout krijgen over een "undefined" veld.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      result[key] = stripUndefined(entry);
    }

    return result as T;
  }

  return value;
}

export class FirestoreMissionEngineStore implements MissionEngineStore {
  async findMission(missionId: EntityId): Promise<MissionV2 | null> {
    const snapshot = await adminDb
      .collection(MISSIONS_COLLECTION)
      .doc(missionId)
      .get();

    if (!snapshot.exists) {
      return null;
    }

    return snapshot.data() as MissionV2;
  }

  async hasProcessedCommand(commandId: EntityId): Promise<boolean> {
    const snapshot = await adminDb
      .collection(COMMANDS_COLLECTION)
      .doc(commandId)
      .get();

    return snapshot.exists;
  }

  async commitCreate(commandId: EntityId, mutation: MissionMutation): Promise<void> {
    const missionRef = adminDb
      .collection(MISSIONS_COLLECTION)
      .doc(mutation.mission.missionId);
    const commandRef = adminDb.collection(COMMANDS_COLLECTION).doc(commandId);
    const outboxRef = adminDb.collection(OUTBOX_COLLECTION).doc(mutation.event.eventId);

    await adminDb.runTransaction(async (tx) => {
      const [commandSnapshot, missionSnapshot] = await Promise.all([
        tx.get(commandRef),
        tx.get(missionRef),
      ]);

      if (commandSnapshot.exists) {
        throw new DuplicateCommandError(`Command ${commandId} is al verwerkt.`);
      }

      if (missionSnapshot.exists) {
        throw new MissionVersionConflictError(
          `Mission ${mutation.mission.missionId} bestaat al.`,
        );
      }

      tx.set(missionRef, stripUndefined(mutation.mission));
      tx.set(commandRef, {
        commandId,
        missionId: mutation.mission.missionId,
        processedAt: FieldValue.serverTimestamp(),
      });
      tx.set(outboxRef, stripUndefined(mutation.event));
    });
  }

  async commitUpdate(
    commandId: EntityId,
    expectedVersion: number,
    mutation: MissionMutation,
  ): Promise<void> {
    const missionRef = adminDb
      .collection(MISSIONS_COLLECTION)
      .doc(mutation.mission.missionId);
    const commandRef = adminDb.collection(COMMANDS_COLLECTION).doc(commandId);
    const outboxRef = adminDb.collection(OUTBOX_COLLECTION).doc(mutation.event.eventId);

    await adminDb.runTransaction(async (tx) => {
      const [commandSnapshot, missionSnapshot] = await Promise.all([
        tx.get(commandRef),
        tx.get(missionRef),
      ]);

      if (commandSnapshot.exists) {
        throw new DuplicateCommandError(`Command ${commandId} is al verwerkt.`);
      }

      if (!missionSnapshot.exists) {
        throw new MissionNotFoundError(
          `Mission ${mutation.mission.missionId} bestaat niet.`,
        );
      }

      const current = missionSnapshot.data() as MissionV2;

      if (current.version !== expectedVersion) {
        throw new MissionVersionConflictError(
          `Versieconflict voor mission ${mutation.mission.missionId}. ` +
            `Verwacht ${expectedVersion}, gevonden ${current.version}.`,
        );
      }

      tx.set(missionRef, stripUndefined(mutation.mission));
      tx.set(commandRef, {
        commandId,
        missionId: mutation.mission.missionId,
        processedAt: FieldValue.serverTimestamp(),
      });
      tx.set(outboxRef, stripUndefined(mutation.event));
    });
  }

  async readOutbox(): Promise<DomainEventEnvelope<MissionEventPayload>[]> {
    const snapshot = await adminDb
      .collection(OUTBOX_COLLECTION)
      .orderBy("recordedAt", "asc")
      .get();

    return snapshot.docs.map(
      (doc) => doc.data() as DomainEventEnvelope<MissionEventPayload>,
    );
  }
}
