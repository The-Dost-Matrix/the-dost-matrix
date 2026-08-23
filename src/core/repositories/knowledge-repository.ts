import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/core/firebase/admin";

import type {
  KnowledgeEntry,
  KnowledgeLifecycle,
  KnowledgeReview,
  KnowledgeReviewRecommendation,
  KnowledgeSource,
  KnowledgeStatus,
  KnowledgeType,
} from "@/core/domain/knowledge/knowledge-entry";

const COLLECTION = "knowledge";

export interface CreateKnowledgeEntryInput {
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
  sourceReference?: {
    documentId?: string;
    filename?: string;
    section?: string;
    chunkIndex?: number;
  };

  status?: KnowledgeStatus;
  confidence?: number;

  tags?: string[];
  embedding?: number[];
}

function createFingerprint(
  type: KnowledgeType | undefined,
  title: string | undefined,
  content: string,
): string {
  return createHash("sha256")
    .update(
      [
        type ?? "fact",
        title?.trim().toLowerCase() ?? "",
        content.trim().toLowerCase(),
      ].join("\n"),
    )
    .digest("hex");
}

function isReviewRecommendation(
  value: unknown,
): value is KnowledgeReviewRecommendation {
  return value === "approve" || value === "edit" || value === "reject";
}

function isKnowledgeLifecycle(
  value: unknown,
): value is KnowledgeLifecycle {
  return (
    value === "foundation" ||
    value === "project" ||
    value === "working" ||
    value === "temporary"
  );
}

export async function createKnowledgeEntry(
  input: CreateKnowledgeEntryInput,
): Promise<string> {
  const fingerprint = createFingerprint(
    input.type,
    input.title,
    input.content,
  );

  const duplicate = await adminDb
    .collection(COLLECTION)
    .where("ownerId", "==", input.ownerId)
    .where("fingerprint", "==", fingerprint)
    .limit(1)
    .get();

  if (!duplicate.empty) {
    return duplicate.docs[0].id;
  }

  const now = FieldValue.serverTimestamp();

  const doc = await adminDb.collection(COLLECTION).add({
    ownerId: input.ownerId,

    type: input.type ?? "fact",
    title: input.title?.trim() ?? "",
    summary: input.summary?.trim() ?? "",
    content: input.content.trim(),
    project: input.project?.trim() ?? "",
    lifecycle: input.lifecycle ?? "foundation",

    source: input.source,
    sourceDocument:
      input.sourceDocument ?? input.sourceReference?.filename ?? "",
    sourceSection:
      input.sourceSection ?? input.sourceReference?.section ?? "",
    sourceReference: input.sourceReference ?? {},

    status: input.status ?? "pending",
    confidence: Math.max(0, Math.min(1, input.confidence ?? 0.8)),

    tags: input.tags ?? [],
    embedding: input.embedding ?? [],
    fingerprint,

    createdAt: now,
    updatedAt: now,
    approvedAt: input.status === "approved" ? now : null,
  });

  return doc.id;
}

function mapEntry(
  doc: FirebaseFirestore.DocumentSnapshot,
): KnowledgeEntry {
  const data = doc.data();

  if (!data) {
    throw new Error("Kennisitem kon niet worden gelezen.");
  }

  const storedReview = data.review;

  const review: KnowledgeReview | undefined =
    storedReview &&
    typeof storedReview === "object" &&
    isReviewRecommendation(storedReview.recommendation)
      ? {
          recommendation: storedReview.recommendation,
          confidence:
            typeof storedReview.confidence === "number"
              ? storedReview.confidence
              : 0,
          reason:
            typeof storedReview.reason === "string"
              ? storedReview.reason
              : "",
          issues: Array.isArray(storedReview.issues)
            ? storedReview.issues.filter(
                (issue: unknown): issue is string =>
                  typeof issue === "string",
              )
            : [],
          suggestedTitle:
            typeof storedReview.suggestedTitle === "string"
              ? storedReview.suggestedTitle
              : undefined,
          suggestedContent:
            typeof storedReview.suggestedContent === "string"
              ? storedReview.suggestedContent
              : undefined,
          reviewedAt: storedReview.reviewedAt?.toDate?.() ?? null,
          model:
            typeof storedReview.model === "string"
              ? storedReview.model
              : "",
        }
      : undefined;

  return {
    id: doc.id,
    ownerId: data.ownerId as string,

    type: data.type as KnowledgeType | undefined,
    title: typeof data.title === "string" ? data.title : undefined,
    summary: typeof data.summary === "string" ? data.summary : undefined,
    content: typeof data.content === "string" ? data.content : "",
    project: typeof data.project === "string" ? data.project : undefined,
    lifecycle: isKnowledgeLifecycle(data.lifecycle)
      ? data.lifecycle
      : undefined,

    source: data.source as KnowledgeSource,
    sourceDocument:
      typeof data.sourceDocument === "string"
        ? data.sourceDocument
        : data.sourceReference?.filename,
    sourceSection:
      typeof data.sourceSection === "string"
        ? data.sourceSection
        : data.sourceReference?.section,

    status: data.status as KnowledgeStatus | undefined,
    confidence:
      typeof data.confidence === "number" ? data.confidence : undefined,

    tags: Array.isArray(data.tags)
      ? data.tags.filter(
          (tag: unknown): tag is string => typeof tag === "string",
        )
      : [],

    embedding: Array.isArray(data.embedding)
      ? data.embedding.filter(
          (value: unknown): value is number => typeof value === "number",
        )
      : [],

    createdAt: data.createdAt?.toDate?.() ?? null,
    updatedAt: data.updatedAt?.toDate?.() ?? null,
    approvedAt: data.approvedAt?.toDate?.() ?? null,
    review,
  };
}

export async function getKnowledgeEntries(
  ownerId: string,
  limit = 500,
): Promise<KnowledgeEntry[]> {
  const snapshot = await adminDb
    .collection(COLLECTION)
    .where("ownerId", "==", ownerId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map(mapEntry);
}

export async function getKnowledgeEntryById(
  ownerId: string,
  id: string,
): Promise<KnowledgeEntry> {
  const snapshot = await adminDb.collection(COLLECTION).doc(id).get();

  if (!snapshot.exists || snapshot.data()?.ownerId !== ownerId) {
    throw new Error("Kennisitem niet gevonden.");
  }

  return mapEntry(snapshot);
}

export async function updateKnowledgeStatus(
  ownerId: string,
  id: string,
  status: KnowledgeStatus,
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const snapshot = await ref.get();

  if (!snapshot.exists || snapshot.data()?.ownerId !== ownerId) {
    throw new Error("Kennisitem niet gevonden.");
  }

  await ref.update({
    status,
    updatedAt: FieldValue.serverTimestamp(),
    approvedAt:
      status === "approved"
        ? FieldValue.serverTimestamp()
        : null,
  });
}

export interface UpdateKnowledgeEntryInput {
  title?: string;
  summary?: string;
  content?: string;
  project?: string;
  lifecycle?: KnowledgeLifecycle;
  type?: KnowledgeType;
  confidence?: number;
  tags?: string[];
}

export async function updateKnowledgeEntry(
  ownerId: string,
  id: string,
  updates: UpdateKnowledgeEntryInput,
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const snapshot = await ref.get();

  if (!snapshot.exists || snapshot.data()?.ownerId !== ownerId) {
    throw new Error("Kennisitem niet gevonden.");
  }

  await ref.update({
    ...updates,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateKnowledgeReview(
  ownerId: string,
  id: string,
  review: KnowledgeReview,
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const snapshot = await ref.get();

  if (!snapshot.exists || snapshot.data()?.ownerId !== ownerId) {
    throw new Error("Kennisitem niet gevonden.");
  }

  await ref.update({
    review: {
      recommendation: review.recommendation,
      confidence: review.confidence,
      reason: review.reason,
      issues: review.issues,
      suggestedTitle: review.suggestedTitle ?? null,
      suggestedContent: review.suggestedContent ?? null,
      reviewedAt: FieldValue.serverTimestamp(),
      model: review.model,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
}