export interface ExecuteBuilderRoleInput {
    missionId: string;
    ownerId: string;
    command: string;
  }
  
  export async function executeBuilderRole(
    _input: ExecuteBuilderRoleInput,
  ): Promise<void> {
    throw new Error("Builder-rol is nog niet geïmplementeerd.");
  }