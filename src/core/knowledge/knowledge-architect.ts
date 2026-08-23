import type {
    KnowledgeLifecycle,
    KnowledgeType,
  } from "@/core/domain/knowledge/knowledge-entry";
  
  export type ExtractedKnowledgeItem = {
    title: string;
    content: string;
    type: KnowledgeType;
    section?: string;
    tags?: string[];
    lifecycle?: KnowledgeLifecycle;
  };
  
  function normalizeText(value: string): string {
    return value.trim().replace(/\s+/g, " ");
  }
  
  function determineLifecycle(
    type: KnowledgeType,
  ): KnowledgeLifecycle {
    switch (type) {
      case "vision":
      case "goal":
      case "architecture":
      case "preference":
      case "process":
      case "lesson":
        return "foundation";
  
      case "project":
      case "decision":
      case "risk":
      case "open_question":
        return "project";
  
      case "task":
        return "working";
  
      case "fact":
      case "person":
      case "company":
      case "legacydocument":
      default:
        return "foundation";
    }
  }
  
  function isWeakKnowledgeItem(
    title: string,
    content: string,
  ): boolean {
    if (title.length < 8 || content.length < 40) {
      return true;
    }
  
    const weakTitles = new Set([
      "test",
      "geen fouten",
      "klaar",
      "opmerking",
      "algemene informatie",
      "overzicht",
      "volgende stap",
    ]);
  
    return weakTitles.has(title.toLowerCase());
  }
  
  export function reviewKnowledgeItems(
    items: ExtractedKnowledgeItem[],
  ): ExtractedKnowledgeItem[] {
    const seen = new Set<string>();
  
    return items.flatMap((item) => {
      const title = normalizeText(item.title);
      const content = normalizeText(item.content);
  
      if (
        !title ||
        !content ||
        isWeakKnowledgeItem(title, content)
      ) {
        return [];
      }
  
      const tags = Array.from(
        new Set(
          (item.tags ?? [])
            .map((tag) => normalizeText(tag).toLowerCase())
            .filter(Boolean),
        ),
      ).slice(0, 12);
  
      const key = [
        item.type,
        title.toLowerCase(),
        content.toLowerCase(),
      ].join("::");
  
      if (seen.has(key)) {
        return [];
      }
  
      seen.add(key);
  
      return [
        {
          ...item,
          title,
          content,
          section: item.section
            ? normalizeText(item.section)
            : undefined,
          tags,
          lifecycle:
            item.lifecycle ?? determineLifecycle(item.type),
        },
      ];
    });
  }