// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * De route onder test importeert de mission-engine "director runtime" en
 * geeft fouten die daaruit voortkomen door als JSON. We mocken hier de hele
 * runtime-module: elke functie die de route zou kunnen aanroepen gooit een
 * `MissionSignoffRequiredError`. Zo testen we de contractuele afspraak
 * ("wanneer de director aangeeft dat een mergecommit needs-signoff is, geeft
 * de route `code: "NEEDS_SIGNOFF"` terug") zonder afhankelijk te zijn van de
 * exacte interne aanroepstructuur van de route-handler.
 */
vi.mock("@/core/mission-engine/v2/director-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@/core/mission-engine/v2/director-runtime")
  >("@/core/mission-engine/v2/director-runtime");

  const signoffMessage =
    "Mission pull request kan niet automatisch worden gemerged (risicoclassificatie: needs-signoff).";

  const mocked: Record<string, unknown> = { ...actual };

  for (const [exportName, exportValue] of Object.entries(actual)) {
    if (typeof exportValue === "function" && exportName !== "MissionSignoffRequiredError") {
      mocked[exportName] = vi.fn().mockRejectedValue(
        new actual.MissionSignoffRequiredError(signoffMessage),
      );
    }
  }

  return mocked;
});

import { MissionSignoffRequiredError } from "@/core/mission-engine/v2/director-runtime";
import { POST } from "./route";

describe("POST /api/missions/v2 - needs-signoff foutcode", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("geeft een gestructureerd code-veld NEEDS_SIGNOFF terug in de foutrespons", async () => {
    const request = new NextRequest("http://localhost/api/missions/v2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ missionId: "mission-test-1" }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.ok).toBe(false);
    expect(payload).toHaveProperty("code", "NEEDS_SIGNOFF");
    expect(typeof payload.error).toBe("string");
    expect(payload.error).toContain("risicoclassificatie: needs-signoff");
  });

  it("bewaart de machineleesbare code op de MissionSignoffRequiredError zelf", () => {
    const error = new MissionSignoffRequiredError(
      "Mission pull request kan niet automatisch worden gemerged (risicoclassificatie: needs-signoff).",
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("NEEDS_SIGNOFF");
    expect(error.message).toContain("risicoclassificatie: needs-signoff");
  });
});