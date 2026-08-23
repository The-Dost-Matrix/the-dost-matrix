import {
  collection,
  limit as limitTo,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "@/core/firebase/client";

import type {
  KnowledgeEntry,
  KnowledgeReviewRecommendation,
  KnowledgeSource,
  KnowledgeStatus,
  KnowledgeType,
} from "@/core/domain/knowledge/knowledge-entry";

export function subscribeToKnowledge(
  ownerId: string,
  onChange: (entries: KnowledgeEntry[]) => void,
  onError: (error: Error) => void,
  max = 25,
): () => void {
  const knowledgeQuery = query(
    collection(db, "knowledge"),
    where("ownerId", "==", ownerId),
    orderBy("createdAt", "desc"),
    limitTo(max),
  );

  return onSnapshot(
    knowledgeQuery,
    (snapshot) => {
      const entries = snapshot.docs.map((document) => {
        const data = document.data();

        return {
          id: document.id,
          ownerId: data.ownerId as string,

          type: data.type as KnowledgeType | undefined,
          title:
            typeof data.title === "string"
              ? data.title
              : undefined,
          summary:
            typeof data.summary === "string"
              ? data.summary
              : undefined,
          content: data.content as string,
          project:
            typeof data.project === "string"
              ? data.project
              : undefined,

          source: data.source as KnowledgeSource,
          sourceDocument:
            typeof data.sourceDocument === "string"
              ? data.sourceDocument
              : undefined,
          sourceSection:
            typeof data.sourceSection === "string"
              ? data.sourceSection
              : undefined,

          status: data.status as KnowledgeStatus | undefined,
          confidence:
            typeof data.confidence === "number"
              ? data.confidence
              : undefined,

          tags: (data.tags as string[]) ?? [],
          embedding: [],

          createdAt:
            data.createdAt?.toDate?.() ?? null,
          updatedAt:
            data.updatedAt?.toDate?.() ?? null,
          approvedAt:
            data.approvedAt?.toDate?.() ?? null,
          review:
            data.review &&
            typeof data.review === "object" &&
            (["approve", "edit", "reject"] as const).includes(
              data.review.recommendation as KnowledgeReviewRecommendation,
            )
              ? {
                  recommendation:
                    data.review.recommendation as KnowledgeReviewRecommendation,
                  confidence:
                    typeof data.review.confidence === "number"
                      ? data.review.confidence
                      : 0,
                  reason:
                    typeof data.review.reason === "string"
                      ? data.review.reason
                      : "",
                  issues: Array.isArray(data.review.issues)
                    ? data.review.issues.filter(
                        (issue: unknown): issue is string =>
                          typeof issue === "string",
                      )
                    : [],
                  suggestedTitle:
                    typeof data.review.suggestedTitle === "string"
                      ? data.review.suggestedTitle
                      : undefined,
                  suggestedContent:
                    typeof data.review.suggestedContent === "string"
                      ? data.review.suggestedContent
                      : undefined,
                  reviewedAt:
                    data.review.reviewedAt?.toDate?.() ?? null,
                  model:
                    typeof data.review.model === "string"
                      ? data.review.model
                      : "",
                }
              : undefined,
        } satisfies KnowledgeEntry;
      });

      onChange(entries);
    },
    onError,
  );
}