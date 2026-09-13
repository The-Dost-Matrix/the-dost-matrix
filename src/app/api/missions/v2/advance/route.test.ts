import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Deze route roept alleen advanceMissionsForOwner() aan (zie autonomous-advance.ts)
 * — dat volledig mocken voorkomt dat een test hier per ongeluk bij de echte
 * Firestore-store, Director-runtime of Role-runtime uitkomt (en dus,
 * transitief, bij de Firebase Admin SDK).
 */
vi.mock("@/core/mission-engine/v2/autonomous-advance", () => ({
  advanceMissionsForOwner: vi.fn(),
}));

import { advanceMissionsForOwner } from "@/core/mission-engine/v2/autonomous-advance";
import { POST } from "./route";

const ORIGINAL_ENV = { ...process.env };

function buildRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://the-dost-matrix.vercel.app/api/missions/v2/advance", {
    method: "POST",
    headers,
  });
}

describe("POST /api/missions/v2/advance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MISSION_ADVANCE_SECRET = "test-secret-value";
    process.env.MISSION_ADVANCE_OWNER_ID = "owner-1";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("wijst een aanvraag zonder Authorization-header af met 401", async () => {
    const response = await POST(buildRequest());

    expect(response.status).toBe(401);
    expect(advanceMissionsForOwner).not.toHaveBeenCalled();
  });

  it("wijst een aanvraag met het verkeerde geheim af met 401", async () => {
    const response = await POST(buildRequest({ authorization: "Bearer helemaal-verkeerd" }));

    expect(response.status).toBe(401);
    expect(advanceMissionsForOwner).not.toHaveBeenCalled();
  });

  it("wijst elke aanvraag af (401) wanneer MISSION_ADVANCE_SECRET niet is ingesteld — nooit per ongeluk open", async () => {
    delete process.env.MISSION_ADVANCE_SECRET;

    const response = await POST(buildRequest({ authorization: "Bearer wat-dan-ook" }));

    expect(response.status).toBe(401);
    expect(advanceMissionsForOwner).not.toHaveBeenCalled();
  });

  it("geeft 500 terug wanneer MISSION_ADVANCE_OWNER_ID ontbreekt", async () => {
    delete process.env.MISSION_ADVANCE_OWNER_ID;

    const response = await POST(buildRequest({ authorization: "Bearer test-secret-value" }));

    expect(response.status).toBe(500);
    expect(advanceMissionsForOwner).not.toHaveBeenCalled();
  });

  it("roept advanceMissionsForOwner aan met de eigenaar uit de omgevingsvariabele bij een geldig geheim", async () => {
    vi.mocked(advanceMissionsForOwner).mockResolvedValue({
      ownerId: "owner-1",
      consideredMissions: 2,
      outcomes: [],
      deadlineReachedBeforeAllDone: false,
      durationMs: 42,
    });

    const response = await POST(buildRequest({ authorization: "Bearer test-secret-value" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.consideredMissions).toBe(2);
    expect(advanceMissionsForOwner).toHaveBeenCalledWith(
      "owner-1",
      expect.objectContaining({ deadlineAt: expect.any(Number) }),
    );
  });

  it("geeft 500 terug (zonder het geheim te lekken) als advanceMissionsForOwner zelf faalt", async () => {
    vi.mocked(advanceMissionsForOwner).mockRejectedValue(new Error("Firestore is onbereikbaar."));

    const response = await POST(buildRequest({ authorization: "Bearer test-secret-value" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Firestore is onbereikbaar.");
    expect(JSON.stringify(body)).not.toContain("test-secret-value");
  });
});
