import type { DomainEventEnvelope, EntityId } from "@/core/contracts/v2";
import type { MissionEventPayload } from "./events";
import type { MissionV2 } from "./mission";

export class MissionNotFoundError extends Error {}
export class MissionVersionConflictError extends Error {}
export class DuplicateCommandError extends Error {}

export interface MissionMutation {
  mission: MissionV2;
  event: DomainEventEnvelope<MissionEventPayload>;
}

export interface MissionEngineStore {
  findMission(missionId: EntityId): Promise<MissionV2 | null>;
  hasProcessedCommand(commandId: EntityId): Promise<boolean>;
  commitCreate(commandId: EntityId, mutation: MissionMutation): Promise<void>;
  commitUpdate(
    commandId: EntityId,
    expectedVersion: number,
    mutation: MissionMutation,
  ): Promise<void>;
  readOutbox(): Promise<DomainEventEnvelope<MissionEventPayload>[]>;
}

export class InMemoryMissionEngineStore implements MissionEngineStore {
  private readonly missions = new Map<EntityId, MissionV2>();
  private readonly processedCommands = new Set<EntityId>();
  private readonly outbox: DomainEventEnvelope<MissionEventPayload>[] = [];

  async findMission(missionId: EntityId): Promise<MissionV2 | null> {
    const mission = this.missions.get(missionId);
    return mission ? structuredClone(mission) : null;
  }

  async hasProcessedCommand(commandId: EntityId): Promise<boolean> {
    return this.processedCommands.has(commandId);
  }

  async commitCreate(commandId: EntityId, mutation: MissionMutation): Promise<void> {
    this.assertNewCommand(commandId);
    if (this.missions.has(mutation.mission.missionId)) {
      throw new MissionVersionConflictError(
        `Mission ${mutation.mission.missionId} bestaat al.`,
      );
    }
    this.missions.set(mutation.mission.missionId, structuredClone(mutation.mission));
    this.outbox.push(structuredClone(mutation.event));
    this.processedCommands.add(commandId);
  }

  async commitUpdate(
    commandId: EntityId,
    expectedVersion: number,
    mutation: MissionMutation,
  ): Promise<void> {
    this.assertNewCommand(commandId);
    const current = this.missions.get(mutation.mission.missionId);
    if (!current) {
      throw new MissionNotFoundError(
        `Mission ${mutation.mission.missionId} bestaat niet.`,
      );
    }
    if (current.version !== expectedVersion) {
      throw new MissionVersionConflictError(
        `Versieconflict voor mission ${mutation.mission.missionId}. ` +
          `Verwacht ${expectedVersion}, gevonden ${current.version}.`,
      );
    }
    this.missions.set(mutation.mission.missionId, structuredClone(mutation.mission));
    this.outbox.push(structuredClone(mutation.event));
    this.processedCommands.add(commandId);
  }

  async readOutbox(): Promise<DomainEventEnvelope<MissionEventPayload>[]> {
    return structuredClone(this.outbox);
  }

  private assertNewCommand(commandId: EntityId): void {
    if (this.processedCommands.has(commandId)) {
      throw new DuplicateCommandError(`Command ${commandId} is al verwerkt.`);
    }
  }
}
