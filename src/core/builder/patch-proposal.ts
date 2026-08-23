import { getChatProvider } from "@/core/llm/model-router";
import type { LlmMessage } from "@/core/llm/types";

import type { BuildContext } from "./build-context";

export interface PatchProposal {
  summary: string;
  reasoning: string;
  changes: string;
}

export async function createPatchProposal(
  context: BuildContext,
): Promise<PatchProposal> {
  const provider = getChatProvider();

  const systemPrompt = `
You are the Builder Agent of The Dost Matrix.

Your task is NOT to write files.

Your task is ONLY to propose the implementation.

Return ONLY valid JSON.

Schema:

{
  "summary":"...",
  "reasoning":"...",
  "changes":"..."
}
`;

  const messages: LlmMessage[] = [
    {
      role: "user",
      content: JSON.stringify(context),
    },
  ];

  const response = await provider.chatCompletion(systemPrompt, messages);

  return JSON.parse(response.content) as PatchProposal;
}