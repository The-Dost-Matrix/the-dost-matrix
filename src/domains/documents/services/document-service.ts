import { DocumentRecord } from "../model/document";
import * as DocumentRepository from "@/core/repositories/document-repository";

export async function uploadDocument(
  document: DocumentRecord
): Promise<DocumentRecord> {
  return DocumentRepository.createDocument(document);
}

export async function getDocument(
  documentId: string
): Promise<DocumentRecord | null> {
  return DocumentRepository.getDocument(documentId);
}

export async function getDocumentsByOwner(
  ownerId: string
): Promise<DocumentRecord[]> {
  return DocumentRepository.getDocumentsByOwner(ownerId);
}

export async function updateDocument(
  documentId: string,
  updates: Partial<DocumentRecord>
): Promise<void> {
  return DocumentRepository.updateDocument(documentId, updates);
}

export async function updateDocumentStatus(
  documentId: string,
  status: DocumentRecord["status"]
): Promise<void> {
  return DocumentRepository.updateDocumentStatus(documentId, status);
}

export async function deleteDocument(
  documentId: string
): Promise<void> {
  return DocumentRepository.deleteDocument(documentId);
}