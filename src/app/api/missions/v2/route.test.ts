import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { POST } from "./route";
import * as directorRuntime from "@/core/mission-engine/v2/director-runtime";

vi.mock("@/core/mission-engine/v2/director-runtime", () => ({
  runDirectorStep: vi.fn(),
}));

/**
 * Bouwt een NextRequest met een JSON-body, zodat we de POST-handler van de
 * route isoleren van een echte HTTP-server.
 */
function buildJsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/missions/v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/missions/v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("geeft de gestructureerde NEEDS_SIGNOFF-foutcode door in de JSON-respons in plaats van alleen een tekstuele foutmelding", async () => {
    const needsSignoffError = Object.assign(
      new Error(
        "De pull request kan niet automatisch gemerged worden: risicoclassificatie vereist handmatige goedkeuring.",
      ),
      { code: "NEEDS_SIGNOFF" as const },
    );

    vi.mocked(directorRuntime.runDirectorStep).mockRejectedValueOnce(needsSignoffError);

    const response = await POST(
      buildJsonRequest({
        missionId: "mission-123",
        action: "approve-and-merge",
      }),
    );

    expect(directorRuntime.runDirectorStep).toHaveBeenCalledTimes(1);
    expect(response.status).toBeGreaterThanOrEqual(400);

    const json = await response.json();

    // De essentie van deze test: de client mag nooit meer op de bewoording
    // van de foutmelding hoeven te matchen. Het machineleesbare code-veld
    // moet ongewijzigd van director-runtime tot in de API-respons meelopen.
    expect(json.code).toBe("NEEDS_SIGNOFF");
    expect(typeof json.error).toBe("string");
    expect(json.error).toContain("risicoclassificatie");
  });

  it("retourneert een 400-fout met 'Veld action ontbreekt' wanneer het action-veld ontbreekt, zonder de director-runtime aan te roepen", async () => {
    const response = await POST(
      buildJsonRequest({
        missionId: "mission-123",
      }),
    );

    expect(response.status).toBe(400);

    const json = await response.json();

    expect(json.error).toMatch(/Veld action ontbreekt/i);
    expect(directorRuntime.runDirectorStep).not.toHaveBeenCalled();
  });

  it("geeft een andere, niet-needs-signoff foutcode eveneens gestructureerd door", async () => {
    const conflictError = Object.assign(new Error("De pull request is inmiddels gesloten door een andere gebruiker."), {
      code: "PULL_REQUEST_CLOSED" as const,
    });

    vi.mocked(directorRuntime.runDirectorStep).mockRejectedValueOnce(conflictError);

    const response = await POST(
      buildJsonRequest({
        missionId: "mission-123",
        action: "approve-and-merge",
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);

    const json = await response.json();

    expect(json.code).toBe("PULL_REQUEST_CLOSED");
    expect(json.code).not.toBe("NEEDS_SIGNOFF");
  });
});