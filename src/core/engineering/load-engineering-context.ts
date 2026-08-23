import {
  createEngineeringContext,
  type EngineeringContext,
} from "./engineering-context";
import { getEngineeringKnowledge } from "./engineering-knowledge";

export async function loadEngineeringContext(
  ownerId: string,
): Promise<EngineeringContext> {
  const context = createEngineeringContext();

  const approvedKnowledge =
    await getEngineeringKnowledge(ownerId);

  context.approvedKnowledge = approvedKnowledge;

  const constitution = approvedKnowledge.find(
    (entry) =>
      entry.title?.trim().toLowerCase() ===
      "engineering constitution",
  );

  if (constitution) {
    context.constitution = constitution.content;
  }

  const engineering = approvedKnowledge.find(
    (entry) =>
      entry.title?.trim().toLowerCase() ===
      "engineering",
  );

  if (engineering) {
    context.engineering = engineering.content;
  }

  return context;
}