import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * route.ts (en, via director-runtime.ts, ook de kennis-ophaallaag) importeert
 * uiteindelijk @/core/firebase/admin, dat op moduleniveau meteen de Firebase
 * Admin SDK initialiseert. Zonder deze mock crasht elke test hier al bij het
 * laden van de module. verifyIdToken wordt hieronder gemockt om een geldige
 * ownerId terug te geven, zodat requireOwnerId() in route.ts slaagt.
 */
vi.mock("@/core/firebase/admin", () => ({
  adminAuth: {},
  adminDb: {},
  verifyIdToken: vi.fn().mockResolvedValue({ uid: "owner-1" }),
}));

/**
 * createMissionEngineV2() geeft normaal een echte, Firestore-backed engine
 * terug (zie engine-factory.ts) — die vervangen we hier door een engine met
 * een controleerbare, gemockte getMission(), zodat handleAutoStep/
 * handleApproveAndMerge in route.ts niet bij een echte Firestore-aanroep
 * uitkomen.
 *
 * Belangrijk: de factory geeft bewust telkens hetzelfde engine-object terug
 * (één singleton, hier aangemaakt binnen de mock-factory), in plaats van bij
 * elke aanroep een nieuw object. route.ts roept createMissionEngineV2() zelf
 * ook aan binnen handleAutoStep/handleApproveAndMerge — als dat een ander
 * object met een andere, ongemockte getMission() zou opleveren dan degene die
 * mockActiveMission() hieronder heeft voorbereid, dan geeft getMission()
 * `undefined` terug en eindigt elke test in een 404 in plaats van bij de
 * daadwerkelijk te testen foutafhandeling.
 */
vi.mock("@/core/mission-engine/v2/engine-factory", () => {
  const engine = { getMission: vi.fn(), recordOwnerInput: vi.fn() };
  return {
    createMissionEngineV2: vi.fn(() => engine),
  };
});

/**
 * Alleen de twee functies mocken die route.ts daadwerkelijk uit dit bestand
 * importeert (runDirectorStep voor "auto-step", approveAndMergeMissionPullRequest
 * voor "approve-and-merge") — zie de imports bovenin route.ts.
 */
vi.mock("@/core/mission-engine/v2/director-runtime", () => ({
  runDirectorStep: vi.fn(),
  approveAndMergeMissionPullRequest: vi.fn(),
}));

import { POST } from "./route";
import * as directorRuntime from "@/core/mission-engine/v2/director-runtime";
import { createMissionEngineV2 } from "@/core/mission-engine/v2/engine-factory";

/**
 * Bouwt een NextRequest met een JSON-body, zodat we de POST-handler van de
 * route isoleren van een echte HTTP-server.
 */
function buildJsonRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/missions/v2", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

/**
 * Laat de gemockte engine.getMission() een minimale, actieve missie
 * teruggeven die bij de gemockte verifyIdToken-ownerId hoort (nodig om
 * langs assertOwnership() in route.ts te komen). Alleen de velden die
 * handleAutoStep/handleApproveAndMerge daadwerkelijk lezen zijn ingevuld —
 * vandaar de cast, in plaats van een volledig MissionV2-object na te bouwen.
 */
function mockActiveMission(overrides: Record<string, unknown> = {}) {
  const mission = {
    missionId: "mission-123",
    ownerId: "owner-1",
    status: "ACTIVE",
    activeAssignmentIds: [],
    ...overrides,
  };

  const engine = createMissionEngineV2();
  vi.mocked(engine.getMission).mockResolvedValue(mission as never);

  return mission;
}

describe("POST /api/missions/v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("geeft de gestructureerde NEEDS_SIGNOFF-foutcode door in de JSON-respons in plaats van alleen een tekstuele foutmelding (via action: auto-step)", async () => {
    mockActiveMission();

    const needsSignoffError = Object.assign(
      new Error(
        "Pull request vereist eigen goedkeuring voordat de Director hem mag mergen (risicoclassificatie: needs-signoff).",
      ),
      { code: "NEEDS_SIGNOFF" as const },
    );
    vi.mocked(directorRuntime.runDirectorStep).mockRejectedValueOnce(needsSignoffError);

    const response = await POST(
      buildJsonRequest({ action: "auto-step", missionId: "mission-123" }),
    );

    expect(directorRuntime.runDirectorStep).toHaveBeenCalledTimes(1);
    expect(response.ok).toBe(false);

    const json = await response.json();

    // De essentie van deze test: de client mag nooit meer op de bewoording
    // van de foutmelding hoeven te matchen. Het machineleesbare code-veld
    // moet ongewijzigd van director-runtime tot in de API-respons meelopen.
    expect(json.code).toBe("NEEDS_SIGNOFF");
    expect(typeof json.error).toBe("string");
    expect(json.error).toContain("risicoclassificatie");
  });

  it("retourneert een 400-fout met 'Veld action ontbreekt' wanneer het action-veld ontbreekt, zonder de director-runtime aan te roepen", async () => {
    const response = await POST(buildJsonRequest({ missionId: "mission-123" }));

    expect(response.status).toBe(400);

    const json = await response.json();

    expect(json.error).toMatch(/action.*ontbreekt/i);
    expect(directorRuntime.runDirectorStep).not.toHaveBeenCalled();
    expect(directorRuntime.approveAndMergeMissionPullRequest).not.toHaveBeenCalled();
  });

  it("geeft een andere, niet-needs-signoff foutcode eveneens gestructureerd door (via action: approve-and-merge)", async () => {
    mockActiveMission();

    const conflictError = Object.assign(
      new Error("De pull request is inmiddels gesloten door een andere gebruiker."),
      { code: "PULL_REQUEST_CLOSED" as const },
    );
    vi.mocked(directorRuntime.approveAndMergeMissionPullRequest).mockRejectedValueOnce(
      conflictError,
    );

    const response = await POST(
      buildJsonRequest({ action: "approve-and-merge", missionId: "mission-123" }),
    );

    expect(directorRuntime.approveAndMergeMissionPullRequest).toHaveBeenCalledTimes(1);
    expect(response.status).toBeGreaterThanOrEqual(400);

    const json = await response.json();

    expect(json.code).toBe("PULL_REQUEST_CLOSED");
    expect(json.code).not.toBe("NEEDS_SIGNOFF");
  });

  describe("action: answer-owner-input (stap 12b)", () => {
    it("geeft requestId en response door aan engine.recordOwnerInput, met criterionOutcome wanneer meegegeven", async () => {
      const mission = mockActiveMission({
        status: "WAITING_FOR_OWNER",
        pendingOwnerInput: { requestId: "input-1", question: "Is dit gehaald?", requestedAt: "2026-09-10T10:00:00.000Z" },
      });
      const engine = createMissionEngineV2();
      const updated = { ...mission, status: "ACTIVE" };
      vi.mocked(engine.recordOwnerInput).mockResolvedValue(updated as never);

      const response = await POST(
        buildJsonRequest({
          action: "answer-owner-input",
          missionId: "mission-123",
          response: "Klopt, ik heb het zelf getest.",
          criterionOutcome: "PASSED",
        }),
      );

      expect(response.ok).toBe(true);
      expect(engine.recordOwnerInput).toHaveBeenCalledTimes(1);
      expect(engine.recordOwnerInput).toHaveBeenCalledWith(
        expect.objectContaining({
          commandType: "RecordOwnerInput",
          targetId: "mission-123",
          payload: {
            requestId: "input-1",
            response: "Klopt, ik heb het zelf getest.",
            criterionOutcome: "PASSED",
          },
        }),
      );

      const json = await response.json();
      expect(json.mission).toEqual(updated);
    });

    it("laat criterionOutcome weg wanneer niet meegegeven, zonder engine.recordOwnerInput te laten falen", async () => {
      mockActiveMission({
        status: "WAITING_FOR_OWNER",
        pendingOwnerInput: { requestId: "input-2", question: "Vraag?", requestedAt: "2026-09-10T10:00:00.000Z" },
      });
      const engine = createMissionEngineV2();
      vi.mocked(engine.recordOwnerInput).mockResolvedValue({ status: "ACTIVE" } as never);

      await POST(
        buildJsonRequest({ action: "answer-owner-input", missionId: "mission-123", response: "Oké." }),
      );

      expect(engine.recordOwnerInput).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { requestId: "input-2", response: "Oké." },
        }),
      );
    });

    it("geeft een 400-fout wanneer de missie geen openstaand inputverzoek heeft", async () => {
      mockActiveMission({ status: "ACTIVE", pendingOwnerInput: undefined });

      const response = await POST(
        buildJsonRequest({ action: "answer-owner-input", missionId: "mission-123", response: "Oké." }),
      );

      expect(response.status).toBe(400);
      const engine = createMissionEngineV2();
      expect(engine.recordOwnerInput).not.toHaveBeenCalled();
    });

    it("geeft een 400-fout wanneer er geen reden is opgegeven", async () => {
      mockActiveMission({
        status: "WAITING_FOR_OWNER",
        pendingOwnerInput: { requestId: "input-3", question: "Vraag?", requestedAt: "2026-09-10T10:00:00.000Z" },
      });

      const response = await POST(
        buildJsonRequest({ action: "answer-owner-input", missionId: "mission-123", response: "   " }),
      );

      expect(response.status).toBe(400);
      const engine = createMissionEngineV2();
      expect(engine.recordOwnerInput).not.toHaveBeenCalled();
    });
  });
});
