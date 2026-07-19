export type RoleName = "Director" | "Builder" | "QA" | "Chronicler";
export type Priority = "Low" | "Medium" | "High";
export type Complexity = "Simple" | "Medium" | "Complex";
export type DirectorPlanStatus = "planned";

export interface DirectorPlan {
  missionId: string;
  ownerId: string;
  priority: Priority;
  complexity: Complexity;
  estimatedHours: number;
  requiredAgents: RoleName[];
  status: DirectorPlanStatus;
  createdAt: Date;
}
