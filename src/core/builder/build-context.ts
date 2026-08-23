import type { BuildTask } from "@/core/domain/tasks/build-task";

import {
  createCodebaseSnapshot,
  type CodebaseSnapshot,
} from "@/core/application/codebase/codebase-scanner";

import {
  readWorkspaceFiles,
  type WorkspaceReadResult,
} from "@/core/application/codebase/workspace-reader";

import {
  selectMissionContext,
  type MissionContext,
} from "./mission-context-selector";

export interface BuildContext {
  task: BuildTask;
  mission: MissionContext;
  codebase: CodebaseSnapshot;
  workspace: WorkspaceReadResult[];
}

export async function createBuildContext(
  task: BuildTask,
): Promise<BuildContext> {
  const mission = await selectMissionContext(task);

  const codebase = await createCodebaseSnapshot();

  const workspace = await readWorkspaceFiles(
    mission.repositoryQueries.map((query) => query.query),
  );

  return {
    task,
    mission,
    codebase,
    workspace,
  };
}