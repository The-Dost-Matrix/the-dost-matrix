import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Zelfde reden als bij missions/v2/route.test.ts: route.ts importeert
 * uiteindelijk @/core/firebase/admin, dat op moduleniveau de Firebase Admin
 * SDK initialiseert. Zonder deze mock crasht elke test al bij het laden.
 */
vi.mock("@/core/firebase/admin", () => ({
  adminAuth: {},
  adminDb: {},
  verifyIdToken: vi.fn().mockResolvedValue({ uid: "owner-1" }),
}));

vi.mock("@/core/application/council/council-service", () => ({
  MAX_COUNCIL_QUESTION_LENGTH: 8_000,
  runCouncilSession: vi.fn(),
}));

vi.mock("@/core/application/council/council-texts", () => ({
  formatCouncilResultForChat: vi.fn(() => "GEFORMATTEERDE RAADSTEKST"),
}));

vi.mock("@/core/repositories/chat-repository", () => ({
  createChatMessage: vi.fn(),
}));

import { POST } from "./route";
import { verifyIdToken } from "@/core/firebase/admin";
import { runCouncilSession } from "@/core/application/council/council-service";
import { createChatMessage } from "@/core/repositories/chat-repository";

function buildJsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/council/ask", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyIdToken).mockResolvedValue({ uid: "owner-1" } as never);
});

describe("POST /api/council/ask", () => {
  it("geeft 401 bij een ongeldig token", async () => {
    vi.mocked(verifyIdToken).mockRejectedValueOnce(new Error("invalid"));

    const response = await POST(buildJsonRequest({ question: "Een vraag?" }));
    expect(response.status).toBe(401);
  });

  it("geeft 400 wanneer question ontbreekt of leeg is", async () => {
    const response = await POST(buildJsonRequest({ question: "   " }));
    expect(response.status).toBe(400);
    expect(runCouncilSession).not.toHaveBeenCalled();
  });

  it("geeft 413 wanneer question de lengtegrens overschrijdt", async () => {
    const response = await POST(buildJsonRequest({ question: "x".repeat(8_001) }));
    expect(response.status).toBe(413);
    expect(runCouncilSession).not.toHaveBeenCalled();
  });

  it("slaat de vraag op vóórdat de raad wordt geraadpleegd, en daarna het geformatteerde antwoord", async () => {
    vi.mocked(runCouncilSession).mockResolvedValue({
      question: "Een vraag?",
      members: [
        { providerId: "anthropic", model: "anthropic/claude-sonnet-5", analysis: "a", critique: "c", verdict: "EENS" },
        { providerId: "openai", model: "openai/gpt-4o", analysis: "a", critique: "c", verdict: "EENS" },
      ],
      agreement: true,
      estimatedCostUsd: 0.01,
    });

    const response = await POST(buildJsonRequest({ question: "Een vraag?" }));

    expect(response.ok).toBe(true);
    expect(createChatMessage).toHaveBeenNthCalledWith(1, {
      ownerId: "owner-1",
      role: "user",
      content: "Een vraag?",
    });
    expect(createChatMessage).toHaveBeenNthCalledWith(2, {
      ownerId: "owner-1",
      role: "assistant",
      content: "GEFORMATTEERDE RAADSTEKST",
      model: "council/anthropic/claude-sonnet-5+openai/gpt-4o",
    });
  });

  it("geeft de eigen foutmelding door wanneer een provider-sleutel ontbreekt", async () => {
    vi.mocked(runCouncilSession).mockRejectedValue(
      new Error("De Dost Council heeft beide providers nodig, maar OPENAI_API_KEY ontbreekt in .env.local."),
    );

    const response = await POST(buildJsonRequest({ question: "Een vraag?" }));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toContain("De Dost Council heeft beide providers nodig");
  });

  it("geeft een generieke foutmelding bij een onverwachte fout, zonder details te lekken", async () => {
    vi.mocked(runCouncilSession).mockRejectedValue(new Error("een of andere interne stacktrace"));

    const response = await POST(buildJsonRequest({ question: "Een vraag?" }));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("De raad kon niet worden geraadpleegd. Probeer het opnieuw.");
  });
});
