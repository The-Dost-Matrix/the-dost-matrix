export interface BuildResult {
    missionId: string;
    taskId: string;
    ownerId: string;
  
    output: string;
  
    status: "completed";
  
    createdAt?: unknown;
    updatedAt?: unknown;
  }