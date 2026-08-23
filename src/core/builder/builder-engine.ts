import type { BuildTask } from "@/core/domain/tasks/build-task";

import { createBuildContext } from "./build-context";
import { createBuildPlan } from "./build-plan";
import { createPatchProposal } from "./patch-proposal";
import {
  createBuilderSession,
  type BuilderSession,
} from "./builder-session";

export async function runBuilderEngine(
  task: BuildTask,
): Promise<BuilderSession> {
  const context = await createBuildContext(task);

  const plan = await createBuildPlan(context);

  const proposal = await createPatchProposal(context);

  return createBuilderSession(
    task,
    context,
    plan,
    proposal,
  );
}