import { NextRequest, NextResponse } from "next/server";
import { verifyIdToken } from "@/core/firebase/admin";
import {
  MAX_CHAT_CONTENT_LENGTH,
  sendChatMessage,
} from "@/core/application/chat/chat-service";
import { withOwnerLlmSettings } from "@/core/repositories/llm-settings-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("LLM-provider geconfigureerd")) {
      return error.message;
    }
    if (error.message.includes("tijdslimiet")) {
      return error.message;
    }
  }

  return "Het bericht kon niet worden verwerkt. Probeer het opnieuw.";
}

export async function POST(request: NextRequest) {
  let ownerId: string;

  try {
    const decoded = await verifyIdToken(request.headers.get("authorization"));
    ownerId = decoded.uid;
  } catch {
    return NextResponse.json(
      { error: "Je sessie is ongeldig of verlopen. Log opnieuw in." },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { content?: unknown }
    | null;

  if (typeof body?.content !== "string" || !body.content.trim()) {
    return NextResponse.json(
      { error: "Veld 'content' ontbreekt of is ongeldig." },
      { status: 400 },
    );
  }

  if (body.content.length > MAX_CHAT_CONTENT_LENGTH) {
    return NextResponse.json(
      {
        error: `Een bericht mag maximaal ${MAX_CHAT_CONTENT_LENGTH.toLocaleString("nl-NL")} tekens bevatten.`,
      },
      { status: 413 },
    );
  }

  try {
    // Stap 24: alles binnen deze wrapper gebruikt de providerkeuze van de
    // eigenaar in plaats van alleen de omgevingsvariabelen.
    const result = await withOwnerLlmSettings(ownerId, () =>
      sendChatMessage(ownerId, body.content as string),
    );
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("Chat request failed", {
      ownerId,
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}
