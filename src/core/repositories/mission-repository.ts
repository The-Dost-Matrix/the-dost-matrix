import {
    addDoc,
    collection,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    where,
  } from "firebase/firestore";
  
  import type {
    Mission,
    MissionSource,
    MissionStatus,
  } from "@/core/domain/missions/mission";
  import { db } from "@/core/firebase/client";
  
  export interface CreateMissionRecordInput {
    ownerId: string;
    command: string;
    status: MissionStatus;
    source: MissionSource;
  }
  
  export async function createMissionRecord({
    ownerId,
    command,
    status,
    source,
  }: CreateMissionRecordInput): Promise<string> {
    const missionDocument = await addDoc(
      collection(db, "missions"),
      {
        ownerId,
        command,
        status,
        source,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    );
  
    return missionDocument.id;
  }
  
  export function subscribeToMissionRecords(
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
      (snapshot) => {
        const missions = snapshot.docs.map((document) => {
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
        });
  
        onChange(missions);
      },
      onError,
    );
  }