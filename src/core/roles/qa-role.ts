export interface ExecuteQaRoleInput {
    missionId: string;
    ownerId: string;
    command: string;
  }
  
  export async function executeQaRole(
    _input: ExecuteQaRoleInput,
  ): Promise<void> {
    throw new Error("QA-rol is nog niet geïmplementeerd.");
  }