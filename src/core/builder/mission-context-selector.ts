import type { BuildTask } from "@/core/domain/tasks/build-task";
import { getChatProvider } from "@/core/llm/model-router";
import type { LlmMessage } from "@/core/llm/types";

export interface RepositoryQuery {
  query: string;
}

export interface KnowledgeQuery {
  query: string;
}

export interface MissionContext {
  repositoryQueries: RepositoryQuery[];
  knowledgeQueries: KnowledgeQuery[];
  confidence: number;
  reasoning: string;
}

export async function selectMissionContext(
  task: BuildTask,
): Promise<MissionContext> {
  const provider = getChatProvider();

  const systemPrompt = `
You are the Mission Context Selector for The Dost Matrix.

Your job is NOT to solve the task.

Your job is ONLY to determine which repository context and knowledge context
must be retrieved before the Builder starts.

Return ONLY valid JSON.

Schema:

{
  "repositoryQueries":[{"query":"..."}],
  "knowledgeQueries":[{"query":"..."}],
  "confidence":0.0,
  "reasoning":"..."
}
`;

  const messages: LlmMessage[] = [
    {
      role: "user",
      content: `
Mission

Title:
${task.title}

Description:
${task.description}
`,
    },
  ];

  const response = await provider.chatCompletion(systemPrompt, messages);

  return JSON.parse(response.content) as MissionContext;
}