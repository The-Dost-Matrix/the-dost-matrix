import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp, where } from "firebase/firestore";
import { recordAuditEvent } from "@/core/application/audit/audit-service";
import { createDirectorPlan } from "@/core/application/director/create-director-plan";
import type { Mission, MissionStatus } from "@/core/domain/missions/mission";
import { db } from "@/core/firebase/client";

export async function createMission(ownerId: string, command: string): Promise<string> {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) throw new Error("Een missieopdracht mag niet leeg zijn.");
  const missionDocument = await addDoc(collection(db, "missions"), {
    ownerId,
    command: normalizedCommand,
    status: "planned" satisfies MissionStatus,
    source: "text",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await recordAuditEvent({
    ownerId,
    action: "mission.created",
    entityType: "mission",
    entityId: missionDocument.id,
    missionId: missionDocument.id,
    summary: normalizedCommand,
  });
  await createDirectorPlan({ missionId: missionDocument.id, ownerId, command: normalizedCommand });
  return missionDocument.id;
}

export function subscribeToMissions(
  ownerId: string,
  onChange: (missions: Mission[]) => void,
  onError: (error: Error) => void,
): () => void {
  const missionsQuery = query(
    collection(db, "missions"),
    where("ownerId", "==", ownerId),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    missionsQuery,
    (snapshot) => onChange(snapshot.docs.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        ownerId: data.ownerId as string,
        command: data.command as string,
        status: data.status as MissionStatus,
        source: data.source === "voice" ? "voice" : "text",
        createdAt: data.createdAt?.toDate?.() ?? null,
        updatedAt: data.updatedAt?.toDate?.() ?? null,
      } satisfies Mission;
    })),
    (error) => onError(error),
  );
}
