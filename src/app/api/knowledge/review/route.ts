import { NextRequest, NextResponse } from "next/server";

import { verifyIdToken } from "@/core/firebase/admin";
import {
  getKnowledgeEntryById,
  updateKnowledgeEntry,
  updateKnowledgeReview,
  updateKnowledgeStatus,
} from "@/core/repositories/knowledge-repository";
import { reviewKnowledgeEntry } from "@/core/application/knowledge/reviewer";

import type {
  KnowledgeStatus,
  KnowledgeType,
} from "@/core/domain/knowledge/knowledge-entry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses: KnowledgeStatus[] = [
  "approved",
  "rejected",
  "archived",
];

const allowedTypes: KnowledgeType[] = [
  "vision",
  "goal",
  "decision",
  "architecture",
  "project",
  "process",
  "preference",
  "lesson",
  "task",
  "risk",
  "open_question",
  "person",
  "company",
  "fact",
  "legacydocument",
];

type ReviewBody = {
  id?: unknown;
  action?: unknown;
  status?: unknown;
  title?: unknown;
  summary?: unknown;
  content?: unknown;
  project?: unknown;
  type?: unknown;
  confidence?: unknown;
  tags?: unknown;
};

export async function POST(request: NextRequest) {
  let ownerId: string;

  try {
    ownerId = (
      await verifyIdToken(request.headers.get("authorization"))
    ).uid;
  } catch {
    return NextResponse.json(
      { error: "Je sessie is ongeldig of verlopen." },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as ReviewBody | null;

  if (typeof body?.id !== "string" || !body.id.trim()) {
    return NextResponse.json(
      { error: "Kennisitem ontbreekt." },
      { status: 400 },
    );
  }


  const isAiReview = body.action === "ai_review";

  if (body.action !== undefined && !isAiReview) {
    return NextResponse.json(
      { error: "Onbekende reviewactie." },
      { status: 400 },
    );
  }

  const hasStatus = body.status !== undefined;

  const hasEditableFields =
    body.title !== undefined ||
    body.summary !== undefined ||
    body.content !== undefined ||
    body.project !== undefined ||
    body.type !== undefined ||
    body.confidence !== undefined ||
    body.tags !== undefined;

  if (!isAiReview && !hasStatus && !hasEditableFields) {
    return NextResponse.json(
      { error: "Er is geen wijziging opgegeven." },
      { status: 400 },
    );
  }

  try {
    if (isAiReview) {
      const entry = await getKnowledgeEntryById(ownerId, body.id);

      if (entry.status !== "pending") {
        return NextResponse.json(
          { error: "Alleen pending kennisitems kunnen door AI worden beoordeeld." },
          { status: 400 },
        );
      }

      const aiReview = await reviewKnowledgeEntry(entry);
      await updateKnowledgeReview(ownerId, body.id, aiReview);

      return NextResponse.json({
        ok: true,
        review: {
          ...aiReview,
          reviewedAt: aiReview.reviewedAt?.toISOString() ?? null,
        },
      });
    }

    if (hasStatus) {
      if (
        typeof body.status !== "string" ||
        !allowedStatuses.includes(body.status as KnowledgeStatus)
      ) {
        return NextResponse.json(
          { error: "Ongeldige reviewactie." },
          { status: 400 },
        );
      }

      await updateKnowledgeStatus(
        ownerId,
        body.id,
        body.status as KnowledgeStatus,
      );
    }

    if (hasEditableFields) {
      const updates: {
        title?: string;
        summary?: string;
        content?: string;
        project?: string;
        type?: KnowledgeType;
        confidence?: number;
        tags?: string[];
      } = {};

      if (body.title !== undefined) {
        if (typeof body.title !== "string" || !body.title.trim()) {
          return NextResponse.json(
            { error: "Titel mag niet leeg zijn." },
            { status: 400 },
          );
        }

        updates.title = body.title.trim().slice(0, 180);
      }

      if (body.summary !== undefined) {
        if (typeof body.summary !== "string") {
          return NextResponse.json(
            { error: "Samenvatting is ongeldig." },
            { status: 400 },
          );
        }

        updates.summary = body.summary.trim().slice(0, 600);
      }

      if (body.content !== undefined) {
        if (typeof body.content !== "string" || !body.content.trim()) {
          return NextResponse.json(
            { error: "Inhoud mag niet leeg zijn." },
            { status: 400 },
          );
        }

        updates.content = body.content.trim().slice(0, 4000);
      }

      if (body.project !== undefined) {
        if (typeof body.project !== "string") {
          return NextResponse.json(
            { error: "Project is ongeldig." },
            { status: 400 },
          );
        }

        updates.project = body.project.trim().slice(0, 180);
      }

      if (body.type !== undefined) {
        if (
          typeof body.type !== "string" ||
          !allowedTypes.includes(body.type as KnowledgeType)
        ) {
          return NextResponse.json(
            { error: "Kennistype is ongeldig." },
            { status: 400 },
          );
        }

        updates.type = body.type as KnowledgeType;
      }

      if (body.confidence !== undefined) {
        if (
          typeof body.confidence !== "number" ||
          !Number.isFinite(body.confidence)
        ) {
          return NextResponse.json(
            { error: "Confidence is ongeldig." },
            { status: 400 },
          );
        }

        updates.confidence = Math.max(
          0,
          Math.min(1, body.confidence),
        );
      }

      if (body.tags !== undefined) {
        if (
          !Array.isArray(body.tags) ||
          !body.tags.every((tag) => typeof tag === "string")
        ) {
          return NextResponse.json(
            { error: "Tags zijn ongeldig." },
            { status: 400 },
          );
        }

        updates.tags = body.tags
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 12);
      }

      await updateKnowledgeEntry(ownerId, body.id, updates);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Kennisitem bijwerken is mislukt.",
      },
      { status: 500 },
    );
  }
}