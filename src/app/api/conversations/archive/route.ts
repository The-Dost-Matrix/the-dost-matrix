import { NextRequest, NextResponse } from "next/server";

import { verifyIdToken } from "@/core/firebase/admin";
import {
  archiveConversationDocument,
} from "@/core/application/conversation/archive-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CONTENT_LENGTH = 500_000;

export async function POST(request: NextRequest) {
  let ownerId: string;

  try {
    ownerId = (
      await verifyIdToken(
        request.headers.get("authorization"),
      )
    ).uid;
  } catch {
    return NextResponse.json(
      {
        error:
          "Je sessie is ongeldig of verlopen.",
      },
      { status: 401 },
    );
  }

  const body = (await request
    .json()
    .catch(() => null)) as {
    filename?: unknown;
    content?: unknown;
  } | null;

  if (
    typeof body?.filename !== "string" ||
    typeof body.content !== "string" ||
    !body.filename.trim() ||
    !body.content.trim()
  ) {
    return NextResponse.json(
      {
        error:
          "Bestandsnaam of inhoud ontbreekt.",
      },
      { status: 400 },
    );
  }

  const filename = body.filename.trim();
  const content = body.content.trim();

  if (!filename.toLowerCase().endsWith(".md")) {
    return NextResponse.json(
      {
        error:
          "Alleen .md-bestanden zijn toegestaan.",
      },
      { status: 400 },
    );
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      {
        error:
          "Het bestand is te groot.",
      },
      { status: 413 },
    );
  }

  try {
    const result =
      await archiveConversationDocument({
        ownerId,
        filename,
        content,
      });

    return NextResponse.json({
      id: result.conversationId,
      // `archived` betekent nu "er is dit keer werkelijk iets weggeschreven",
      // niet "het gesprek zit in het archief". Bij een herkend duplicaat stond
      // het er al, maar is er niets nieuws opgeslagen — en dat verschil hoort
      // het scherm te kunnen zien, anders meldt het opnieuw een geslaagde
      // archivering terwijl er niets gebeurd is.
      archived: !result.duplicate,
      duplicate: result.duplicate,
      chunks: result.chunks,
      embedded: result.embedded,
    });
  } catch (error) {
    console.error(
      "Conversation archive failed",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Conversatie opslaan is mislukt.",
      },
      { status: 500 },
    );
  }
}