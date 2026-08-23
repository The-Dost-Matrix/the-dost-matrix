import { runBuilderEngine } from "./builder-engine";
import {
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/core/firebase/client";

import type { BuildTask } from "@/core/domain/tasks/build-task";


export async function runBuilderTask(taskId: string) {
  const taskRef = doc(db, "agentTasks", taskId);

  const taskSnapshot = await getDoc(taskRef);

  if (!taskSnapshot.exists()) {
    throw new Error(`Builder-taak ${taskId} bestaat niet.`);
  }

  const task = taskSnapshot.data() as BuildTask;

  if (task.status !== "planned") {
    throw new Error(
      `Builder-taak ${taskId} heeft status "${task.status}" en kan niet worden gestart.`,
    );
  }

  await updateDoc(taskRef, {
    status: "building",
    updatedAt: serverTimestamp(),
  });

  console.log(`Builder-taak ${taskId} is gestart.`);


const session = await runBuilderEngine(task);

console.log(
  `Builder Session ${session.id} aangemaakt met status "${session.status}".`,
);

return session;
}