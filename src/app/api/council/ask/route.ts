import { NextRequest, NextResponse } from "next/server";
import { verifyIdToken } from "@/core/firebase/admin";
import {
  MAX_COUNCIL_QUESTION_LENGTH,
  runCouncilSession,
} from "@/core/application/council/council-service";
import { formatCouncilResultForChat } from "@/core/application/council/council-texts";
import { createChatMessage } from "@/core/repositories/chat-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stap 13 — The Dost Council V1 (dun): "Vraag de Raad" vanuit de
 * Director-chat (zie director-chat.tsx). Bewust een eigen route, los van
 * /api/chat: dit stuurt niet aan op de Director-persona, het
 * <workspace-read>/<create-mission>-tagprotocol of het semantische
 * Second Brain-geheugen — alleen op runCouncilSession (zie council-service.ts
 * voor waarom dat een eigen, dunnere bewijslaag heeft).
 *
 * De vraag en het raadsresultaat worden allebei als gewoon chatbericht
 * opgeslagen (zelfde "chatMessages"-collectie als /api/chat), zodat een
 * raadsessie in dezelfde tijdlijn verschijnt als een normaal gesprek met de
 * Director — de bestaande Firestore-subscriptie in director-chat.tsx toont
 * ze zonder verdere aanpassing.
 */

function publicError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("De Dost Council heeft beide providers nodig")) {
      return error.message;
    }
    if (error.message.includes("mag niet leeg zijn") || error.message.includes("mag maximaal")) {
      return error.message;
    }
    if (error.message.includes("tijdslimiet")) {
      return error.message;
    }
  }

  return "De raad kon niet worden geraadpleegd. Probeer het opnieuw.";
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

  const body = (await request.json().catch(() => null)) as { question?: unknown } | null;

  if (typeof body?.question !== "string" || !body.question.trim()) {
    return NextResponse.json(
      { error: "Veld 'question' ontbreekt of is ongeldig." },
      { status: 400 },
    );
  }

  const question = body.question.trim();

  if (question.length > MAX_COUNCIL_QUESTION_LENGTH) {
    return NextResponse.json(
      {
        error: `Een vraag aan de raad mag maximaal ${MAX_COUNCIL_QUESTION_LENGTH.toLocaleString("nl-NL")} tekens bevatten.`,
      },
      { status: 413 },
    );
  }

  try {
    // Zelfde volgorde als sendChatMessage in chat-service.ts: het bericht van
    // de eigenaar staat al in de geschiedenis vóórdat de raad aan het werk
    // gaat, zodat een mislukte raadsessie de vraag niet laat verdwijnen.
    await createChatMessage({ ownerId, role: "user", content: question });

    const result = await runCouncilSession(ownerId, question);
    const formatted = formatCouncilResultForChat(result);

    await createChatMessage({
      ownerId,
      role: "assistant",
      content: formatted,
      model: `council/${result.members.map((member) => member.model).join("+")}`,
    });

    return NextResponse.json(
      { result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("Council request failed", {
      ownerId,
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}
