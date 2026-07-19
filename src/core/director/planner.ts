import type {
    AgentName,
    Complexity,
    DirectorPlan,
    Priority,
  } from "./types";
  
  interface PlanInput {
    missionId: string;
    ownerId: string;
    command: string;
  }
  
  interface AnalysisResult {
    priority: Priority;
    complexity: Complexity;
    estimatedHours: number;
    requiredAgents: AgentName[];
  }
  
  function analyseCommand(command: string): AnalysisResult {
    const normalizedCommand = command.toLowerCase();
  
    let priority: Priority = "Medium";
    let complexity: Complexity = "Medium";
    let estimatedHours = 4;
    const requiredAgents = new Set<AgentName>(["Director"]);
  
    if (
      normalizedCommand.includes("architectuur") ||
      normalizedCommand.includes("systeem") ||
      normalizedCommand.includes("platform")
    ) {
      priority = "High";
      complexity = "Complex";
      estimatedHours = 12;
  
      requiredAgents.add("Builder");
      requiredAgents.add("QA");
      requiredAgents.add("Chronicler");
    }
  
    if (
      normalizedCommand.includes("bouw") ||
      normalizedCommand.includes("maak") ||
      normalizedCommand.includes("ontwikkel")
    ) {
      requiredAgents.add("Builder");
    }
  
    if (
      normalizedCommand.includes("test") ||
      normalizedCommand.includes("controle") ||
      normalizedCommand.includes("kwaliteit")
    ) {
      requiredAgents.add("QA");
    }
  
    if (
      normalizedCommand.includes("document") ||
      normalizedCommand.includes("leg vast") ||
      normalizedCommand.includes("handleiding")
    ) {
      requiredAgents.add("Chronicler");
    }
  
    return {
      priority,
      complexity,
      estimatedHours,
      requiredAgents: Array.from(requiredAgents),
    };
  }
  
  export function createDirectorPlanInput({
    missionId,
    ownerId,
    command,
  }: PlanInput): DirectorPlan {
    const analysis = analyseCommand(command);
  
    return {
      missionId,
      ownerId,
      priority: analysis.priority,
      complexity: analysis.complexity,
      estimatedHours: analysis.estimatedHours,
      requiredAgents: analysis.requiredAgents,
      status: "planned",
      createdAt: new Date(),
    };
  }