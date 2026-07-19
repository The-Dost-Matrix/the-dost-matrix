export interface BuildTask {
    missionId: string;
    ownerId: string;
  
    title: string;
    description: string;
  
    assignedAgent: "Builder";
  
    status:
      | "planned"
      | "building"
      | "completed";
  
    estimatedHours: number;
  
    createdAt?: unknown;
    updatedAt?: unknown;
  }