export type KnowledgeSource =
  | "chat"
  | "manual"
  | "youtube"
  | "document"
  | "mission";

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

/**
 * Verwijzing naar één concrete bron waaruit dit kennisitem is ontstaan.
 *
 * Bewust een eigen type sinds de code-audit van 13 september 2026: vóór die
 * datum bewaarde een kennisitem exact één `sourceReference`, en gooide
 * `createKnowledgeEntry` een tweede, onafhankelijke bron met dezelfde inhoud
 * stilzwijgend weg (het gaf alleen het bestaande id terug). Twee documenten
 * die dezelfde regel onderbouwen zagen er daardoor uit als één bron — het
 * systeem verloor bewijskracht zonder dat ergens zichtbaar was dat er iets
 * verdween.
 */
export interface KnowledgeSourceReference {
  documentId?: string;
  filename?: string;
  section?: string;
  chunkIndex?: number;
}

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

  /**
   * Alle bronnen die dit kennisitem onderbouwen, oudste eerst. Bevat voor
   * items van vóór de audit precies één element (afgeleid van het oude
   * `sourceReference`-veld), zodat bestaande Firestore-documenten geen
   * migratie nodig hebben om gelezen te kunnen worden.
   */
  sourceReferences: KnowledgeSourceReference[];

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