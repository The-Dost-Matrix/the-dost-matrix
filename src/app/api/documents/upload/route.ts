import { NextRequest, NextResponse } from "next/server";

import { verifyIdToken } from "@/core/firebase/admin";
import { uploadDocument } from "@/domains/documents/services/document-service";
import type { DocumentRecord } from "@/domains/documents/model/document";
import { determineSourceType } from "@/domains/documents/model/source-type";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

type UploadRequestBody = {
  fileName?: unknown;
  title?: unknown;
  mimeType?: unknown;
  fileSize?: unknown;
  projectId?: unknown;
  content?: unknown;
  pageCount?: unknown;
  sheetNames?: unknown;
};

/**
 * Stap 25: `content` werd hiervóór uitsluitend voor Markdown aangenomen — elk
 * ander bestandstype leverde niets dan metadata op. Sinds de browser DOCX,
 * XLSX en PDF zelf uitleest (zie src/domains/documents/parsing) komt er ook
 * bij die typen tekst mee, en is de vraag niet langer "welke extensie is dit"
 * maar "is er inhoud meegestuurd".
 *
 * De grens ligt bewust boven de 120.000 tekens die de kennisextractie
 * accepteert: dit is een opslagroute, en een document dat te groot is om er
 * kennis uit te halen mag nog steeds bewaard worden mét zijn tekst.
 */
const MAX_CONTENT_LENGTH = 200_000;

function readSheetNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const names = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 120))
    .filter((item) => item.length > 0)
    .slice(0, 50);

  return names.length > 0 ? names : undefined;
}

function readPageCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 100_000)
    : undefined;
}

function createTitleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 180);
}

export async function POST(request: NextRequest) {
  let ownerId: string;

  try {
    const decodedToken = await verifyIdToken(
      request.headers.get("authorization"),
    );

    ownerId = decodedToken.uid;
  } catch {
    return NextResponse.json(
      { error: "Je sessie is ongeldig of verlopen." },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | UploadRequestBody
    | null;

  const fileName =
    typeof body?.fileName === "string" ? body.fileName.trim() : "";

  const mimeType =
    typeof body?.mimeType === "string"
      ? body.mimeType.trim().toLowerCase()
      : "";

  const fileSize =
    typeof body?.fileSize === "number" &&
    Number.isFinite(body.fileSize) &&
    body.fileSize >= 0
      ? body.fileSize
      : 0;

  if (!fileName) {
    return NextResponse.json(
      { error: "De bestandsnaam ontbreekt." },
      { status: 400 },
    );
  }

  if (!mimeType) {
    return NextResponse.json(
      { error: "Het bestandstype ontbreekt." },
      { status: 400 },
    );
  }

  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "Het bestand is te groot. Maximum is 25 MB." },
      { status: 413 },
    );
  }

  const sourceType = determineSourceType(fileName, mimeType);

  if (!sourceType) {
    return NextResponse.json(
      {
        error:
          "Dit bestandstype wordt niet ondersteund. Gebruik Markdown, PDF, DOCX, XLSX, JPG of PNG.",
      },
      { status: 415 },
    );
  }

  const suppliedTitle =
    typeof body?.title === "string" ? body.title.trim() : "";

  const projectId =
    typeof body?.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : undefined;

  const originalContent =
    typeof body?.content === "string" && body.content.trim()
      ? body.content.slice(0, MAX_CONTENT_LENGTH)
      : undefined;

  const pageCount = readPageCount(body?.pageCount);
  const sheetNames = readSheetNames(body?.sheetNames);

      const document: DocumentRecord = {
        id: "",
        ownerId,
        ...(projectId ? { projectId } : {}),
        title: suppliedTitle.slice(0, 180) || createTitleFromFileName(fileName),
        fileName,
        mimeType,
        sourceType,
        status: "uploaded",
        knowledgeItems: 0,
        ...(originalContent ? { originalContent } : {}),
        uploadedAt: new Date(),
        metadata: {
          fileSize,
          ...(pageCount !== undefined ? { pageCount } : {}),
          ...(sheetNames !== undefined ? { sheetNames } : {}),
        },
      };

      try {
        const createdDocument = await uploadDocument(document);

    return NextResponse.json(
      {
        document: createdDocument,
        message: "Document is geregistreerd.",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Document upload failed", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Het document kon niet worden geregistreerd.",
      },
      { status: 500 },
    );
  }
}