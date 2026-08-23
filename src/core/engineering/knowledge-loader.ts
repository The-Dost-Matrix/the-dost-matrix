export interface KnowledgeDocument {
    id: string;
    title: string;
    content: string;
  }
  
  export async function loadApprovedKnowledge(): Promise<KnowledgeDocument[]> {
    // Wordt later gekoppeld aan de Knowledge Foundation.
    return [];
  }