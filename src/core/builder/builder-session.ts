import type { BuildTask } from "@/core/domain/tasks/build-task";

import type { BuildContext } from "./build-context";
import type { BuildPlan } from "./build-plan";
import type { PatchProposal } from "./patch-proposal";

export interface BuilderSession {
  id: string;
  task: BuildTask;

  context: BuildContext;

  plan: BuildPlan;

  proposal: PatchProposal;

  startedAt: string;

  updatedAt: string;

  status:
    | "running"
    | "review"
    | "approved"
    | "writing"
    | "completed"
    | "failed";
}

export function createBuilderSession(
  task: BuildTask,
  context: BuildContext,
  plan: BuildPlan,
  proposal: PatchProposal,
): BuilderSession {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    task,
    context,
    plan,
    proposal,
    startedAt: now,
    updatedAt: now,
    status: "running",
  };
}