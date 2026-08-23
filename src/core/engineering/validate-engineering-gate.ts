import { createEngineeringGate } from "./engineering-gate";

export async function validateEngineeringGate(
  ownerId: string,
): Promise<boolean> {
  const gate = await createEngineeringGate(ownerId);

  return gate.passed;
}