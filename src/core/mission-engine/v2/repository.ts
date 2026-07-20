import type { EntityId } from "@/core/contracts/v2";
import type { MissionV2 } from "./mission";

export class MissionNotFoundError extends Error {}
export class MissionVersionConflictError extends Error {}

export interface MissionV2Repository {
  findById(missionId: EntityId): Promise<MissionV2 | null>;
  create(mission: MissionV2): Promise<void>;
  save(mission: MissionV2, expectedVersion: number): Promise<void>;
}

export class InMemoryMissionV2Repository implements MissionV2Repository {
  private readonly missions = new Map<EntityId, MissionV2>();

  async findById(missionId: EntityId): Promise<MissionV2 | null> {
    const mission = this.missions.get(missionId);
    return mission ? structuredClone(mission) : null;
  }

  async create(mission: MissionV2): Promise<void> {
    if (this.missions.has(mission.missionId)) {
      throw new MissionVersionConflictError(`Mission ${mission.missionId} bestaat al.`);
    }
    this.missions.set(mission.missionId, structuredClone(mission));
  }

  async save(mission: MissionV2, expectedVersion: number): Promise<void> {
    const current = this.missions.get(mission.missionId);
    if (!current) throw new MissionNotFoundError(`Mission ${mission.missionId} bestaat niet.`);
    if (current.version !== expectedVersion) {
      throw new MissionVersionConflictError(`Versieconflict voor mission ${mission.missionId}. Verwacht ${expectedVersion}, gevonden ${current.version}.`);
    }
    this.missions.set(mission.missionId, structuredClone(mission));
  }
}
