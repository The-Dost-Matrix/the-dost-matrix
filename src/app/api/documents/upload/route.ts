import { NextRequest, NextResponse } from "next/server";

import { verifyIdToken } from "@/core/firebase/admin";
import { uploadDocument } from "@/domains/documents/services/document-service";
import type {
  DocumentRecord,
  DocumentSourceType,
} from "@/domains/documents/model/document";

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
};

function determineSourceType(
  fileName: string,
  mimeType: string,
): DocumentSourceType | null {
  const extension = fileName.toLowerCase().split(".").pop();

  if (
    extension === "md" ||
    mimeType === "text/markdown" ||
    mimeType === "text/plain"
  ) {
    return "markdown";
  }

  if (extension === "pdf" || mimeType === "application/pdf") {
    return "pdf";
  }

  if (
    extension === "docx" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }

  if (
    extension === "xlsx" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "xlsx";
  }

  if (
    extension === "jpg" ||
    extension === "jpeg" ||
    extension === "png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/png"
  ) {
    return "image";
  }

  return null;
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
    sourceType === "markdown" &&
    typeof body?.content === "string" &&
    body.content.trim()
      ? body.content
      : undefined;

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