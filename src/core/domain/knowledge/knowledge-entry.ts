export type KnowledgeSource =
  | "chat"
  | "manual"
  | "youtube"
  | "document";

export type KnowledgeLifecycle =
  | "foundation"
  | "project"
  | "working"
  | "temporary";

export type KnowledgeReviewRecommendation =
  | "approve"
  | "edit"
  | "reject";

export interface KnowledgeReview {
  recommendation: KnowledgeReviewRecommendation;
  confidence: number;
  reason: string;
  issues: string[];
  suggestedTitle?: string;
  suggestedContent?: string;
  reviewedAt: Date | null;
  model: string;
}

export type KnowledgeStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "archived";

export type KnowledgeType =
  | "vision"
  | "goal"
  | "decision"
  | "architecture"
  | "project"
  | "process"
  | "preference"
  | "lesson"
  | "task"
  | "risk"
  | "open_question"
  | "person"
  | "company"
  | "fact"
  | "legacydocument";

export interface KnowledgeEntry {
  id: string;
  ownerId: string;

  type?: KnowledgeType;
  title?: string;
  summary?: string;
  content: string;
  project?: string;
  lifecycle?: KnowledgeLifecycle;

  source: KnowledgeSource;
  sourceDocument?: string;
  sourceSection?: string;

  status?: KnowledgeStatus;
  confidence?: number;

  tags: string[];

  /** Embedding vector for semantic retrieval. Empty when no embedding provider is configured. */
  embedding: number[];

  createdAt: Date | null;
  updatedAt?: Date | null;
  approvedAt?: Date | null;
  review?: KnowledgeReview;
}