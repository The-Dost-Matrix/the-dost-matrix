import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

export interface EngineeringContext {
  constitution: string;
  engineering: string;
  approvedKnowledge: KnowledgeEntry[];
}

export function createEngineeringContext(): EngineeringContext {
  return {
    constitution: "",
    engineering: "",
    approvedKnowledge: [],
  };
}