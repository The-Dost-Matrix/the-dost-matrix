import type { Mission } from "@/core/domain/missions/mission";
import { recordAuditEvent } from "@/core/application/audit/audit-service";
import { startMissionWorkflow } from "@/core/workflows/start-mission-workflow";
import {
  createMissionRecord,
  subscribeToMissionRecords,
} from "@/core/repositories/mission-repository";

export async function createMission(
  ownerId: string,
  command: string,
): Promise<string> {
  const normalizedCommand = command.trim();

  if (!normalizedCommand) {
    throw new Error("Een missieopdracht mag niet leeg zijn.");
  }

  const missionId = await createMissionRecord({
    ownerId,
    command: normalizedCommand,
    status: "planned",
    source: "text",
  });

  await recordAuditEvent({
    ownerId,
    action: "mission.created",
    entityType: "mission",
    entityId: missionId,
    summary: normalizedCommand,
    missionId,
  });

  await startMissionWorkflow({
    missionId,
    ownerId,
    command: normalizedCommand,
  });

  return missionId;
}

export function subscribeToMissions(
  ownerId: string,
  onChange: (missions: Mission[]) => void,
  onError: (error: Error) => void,
): () => void {
  return subscribeToMissionRecords(ownerId, onChange, onError);
}