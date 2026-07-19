import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { createDirectorPlan } from "@/core/director/director";
import { db } from "@/core/firebase/client";
import type { Mission } from "@/shared/types/mission";

export async function createMission(ownerId: string, command: string) {
  const mission = await addDoc(collection(db, "missions"), {
    ownerId,
    command,
    status: "planned",
    source: "text",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await addDoc(collection(db, "auditEvents"), {
    ownerId,
    action: "mission.created",
    entityType: "mission",
    entityId: mission.id,
    summary: command,
    createdAt: serverTimestamp(),
  });
  
  await createDirectorPlan({
    missionId: mission.id,
    ownerId,
    command,
  });
  
  return mission.id;
}

export function subscribeToMissions(
  ownerId: string,
  onChange: (missions: Mission[]) => void,
  onError: (error: Error) => void,
) {
  const missionsQuery = query(
    collection(db, "missions"),
    where("ownerId", "==", ownerId),
    orderBy("createdAt", "desc"),
  );

  return onSnapshot(
    missionsQuery,
    (snapshot) => {
      onChange(
        snapshot.docs.map((document) => {
          const data = document.data();
          return {
            id: document.id,
            ownerId: data.ownerId,
            command: data.command,
            status: data.status,
            source: data.source,
            createdAt: data.createdAt?.toDate?.() ?? null,
          } satisfies Mission;
        }),
      );
    },
    (error) => onError(error),
  );
}
