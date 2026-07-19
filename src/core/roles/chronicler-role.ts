export interface ExecuteChroniclerRoleInput {
    missionId: string;
    ownerId: string;
    command: string;
  }
  
  export async function executeChroniclerRole(
    _input: ExecuteChroniclerRoleInput,
  ): Promise<void> {
    throw new Error("Chronicler-rol is nog niet geïmplementeerd.");
  }