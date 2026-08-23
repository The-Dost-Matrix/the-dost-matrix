import type { BuildContext } from "./build-context";
import { getChatProvider } from "@/core/llm/model-router";

export interface BuildStep {
  title: string;
  description: string;
}

export interface BuildPlan {
  summary: string;
  reasoning: string;
  steps: BuildStep[];
}

export async function createBuildPlan(
  context: BuildContext,
): Promise<BuildPlan> {
  const provider = getChatProvider();

  const systemPrompt = `
You are the Builder Planner of The Dost Matrix.

Do NOT generate code.

Your only task is to create the implementation plan.

Return ONLY JSON.

Schema:

{
  "summary":"...",
  "reasoning":"...",
  "steps":[
    {
      "title":"...",
      "description":"..."
    }
  ]
}
`;

  const response = await provider.chatCompletion(systemPrompt, [
    {
      role: "user",
      content: JSON.stringify(context),
    },
  ]);

  return JSON.parse(response.content);
}