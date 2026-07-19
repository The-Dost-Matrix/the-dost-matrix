export type AgentName =
  | "Director"
  | "Builder"
  | "QA"
  | "Chronicler";

export type Priority =
  | "Low"
  | "Medium"
  | "High";

export type Complexity =
  | "Simple"
  | "Medium"
  | "Complex";

export interface DirectorPlan {
  missionId: string;
  ownerId: string;

  priority: Priority;
  complexity: Complexity;

  estimatedHours: number;

  requiredAgents: AgentName[];

  status: "planned";

  createdAt: Date;
}