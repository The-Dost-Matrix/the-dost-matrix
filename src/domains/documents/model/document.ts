export type DocumentSourceType =
  | "markdown"
  | "pdf"
  | "docx"
  | "xlsx"
  | "image";

export type DocumentStatus =
  | "uploaded"
  | "processing"
  | "review"
  | "completed"
  | "failed";

export interface DocumentRecord {
  id: string;

  ownerId: string;

  projectId?: string;

  title: string;

  fileName: string;

  mimeType: string;

  sourceType: DocumentSourceType;

  status: DocumentStatus;

  knowledgeItems: number;

  originalContent?: string;

  uploadedAt: Date;

  processedAt?: Date;

  errorMessage?: string;

  metadata?: {
    pageCount?: number;
    sheetNames?: string[];
    imageWidth?: number;
    imageHeight?: number;
    fileSize?: number;
  };
}