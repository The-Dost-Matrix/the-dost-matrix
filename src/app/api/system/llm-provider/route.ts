import { NextRequest, NextResponse } from "next/server";

import { verifyIdToken } from "@/core/firebase/admin";
import {
  isChatProviderPreference,
  normalizeOwnerLlmSettings,
} from "@/core/llm/provider-settings";
import {
  getOwnerLlmSettings,
  saveOwnerLlmSettings,
} from "@/core/repositories/llm-settings-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stap 24 — lezen en wijzigen van de providerkeuze vanuit de app.
 *
 * Dit is het hele punt van deze stap: omschakelen zonder Vercel, zonder
 * omgevingsvariabelen, zonder redeploy. De keuze geldt bij de eerstvolgende
 * aanroep.
 *
 * Bewust achter authenticatie en altijd op de ingelogde eigenaar: welk model
 * de Matrix gebruikt, is geen publieke informatie, en een eigenaar mag alleen
 * zijn eigen instelling wijzigen. Er komen hier nooit sleutels langs — alleen
 * de naam van een provider.
 */
export async function GET(request: NextRequest) {
  let ownerId: string;

  try {
    ownerId = (await verifyIdToken(request.headers.get("authorization"))).uid;
  } catch {
    return NextResponse.json(
      { error: "Je sessie is ongeldig of verlopen. Log opnieuw in." },
      { status: 401 },
    );
  }

  const settings = await getOwnerLlmSettings(ownerId);

  return NextResponse.json({
    settings,
    // Welke providers er überhaupt te kiezen zijn: een sleutel die niet is
    // gezet, moet je niet kunnen selecteren — dan zou de keuze pas bij de
    // volgende missie stukgaan in plaats van meteen.
    available: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
    },
  });
}

export async function POST(request: NextRequest) {
  let ownerId: string;

  try {
    ownerId = (await verifyIdToken(request.headers.get("authorization"))).uid;
  } catch {
    return NextResponse.json(
      { error: "Je sessie is ongeldig of verlopen. Log opnieuw in." },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    chatProvider?: unknown;
    chatModel?: unknown;
  } | null;

  if (!isChatProviderPreference(body?.chatProvider)) {
    return NextResponse.json(
      { error: "Kies 'auto', 'anthropic' of 'openai'." },
      { status: 400 },
    );
  }

  // Weigeren in plaats van opslaan wanneer de bijbehorende sleutel ontbreekt:
  // een instelling die gegarandeerd faalt bij de eerstvolgende missie hoort
  // niet stilzwijgend bewaard te worden.
  if (body.chatProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is niet ingesteld, dus Anthropic kan niet gekozen worden." },
      { status: 400 },
    );
  }

  if (body.chatProvider === "openai" && !process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is niet ingesteld, dus OpenAI kan niet gekozen worden." },
      { status: 400 },
    );
  }

  try {
    const saved = await saveOwnerLlmSettings(
      ownerId,
      normalizeOwnerLlmSettings({
        chatProvider: body.chatProvider,
        chatModel: body.chatModel,
      }),
    );

    return NextResponse.json({ settings: saved });
  } catch (error) {
    console.error("Providerinstelling opslaan is mislukt", {
      ownerId,
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json(
      { error: "De providerinstelling kon niet worden opgeslagen." },
      { status: 500 },
    );
  }
}
