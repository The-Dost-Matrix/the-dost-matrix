import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  DirectorErrorCode,
  runDirectorTurn,
  type DirectorRunInput,
  type DirectorRunResult,
  type DirectorRuntimeDeps,
} from "./director-runtime";

function buildInput(overrides: Partial<DirectorRunInput> = {}): DirectorRunInput {
  return {
    missionId: "mission-test-1",
    turnId: "turn-1",
    prompt: "Voer stap uit",
    context: {},
    ...overrides,
  };
}

function buildDeps(overrides: Partial<DirectorRuntimeDeps> = {}): DirectorRuntimeDeps {
  return {
    callModel: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };
}

describe("director-runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runDirectorTurn — gestructureerde foutcodes", () => {
    it("zet errorCode op DirectorErrorCode.NEEDS_SIGNOFF wanneer de risicoclassificatie signoff vereist", async () => {
      const deps = buildDeps({
        callModel: vi.fn().mockResolvedValue({
          ok: false,
          riskClassification: "needs-signoff",
          message: "De actie is geblokkeerd door risicobeleid.",
        }),
      });

      const result: DirectorRunResult = await runDirectorTurn(buildInput(), deps);

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(DirectorErrorCode.NEEDS_SIGNOFF);
    });

    it("blijft NEEDS_SIGNOFF teruggeven ongeacht de exacte bewoording van de foutmelding", async () => {
      const deps = buildDeps({
        callModel: vi.fn().mockResolvedValue({
          ok: false,
          riskClassification: "needs-signoff",
          message: "Deze tekst bevat bewust geen letterlijke marker meer.",
        }),
      });

      const result = await runDirectorTurn(buildInput(), deps);

      expect(result.errorCode).toBe(DirectorErrorCode.NEEDS_SIGNOFF);
    });

    it("geeft geen NEEDS_SIGNOFF errorCode terug als het woord 'signoff' toevallig in een onschuldige foutmelding voorkomt", async () => {
      const deps = buildDeps({
        callModel: vi.fn().mockResolvedValue({
          ok: false,
          riskClassification: "low-risk",
          message: "Interne fout: signoff-cache kon niet worden geladen.",
        }),
      });

      const result = await runDirectorTurn(buildInput(), deps);

      expect(result.errorCode).not.toBe(DirectorErrorCode.NEEDS_SIGNOFF);
    });

    it("laat errorCode ongedefinieerd bij een succesvolle run", async () => {
      const deps = buildDeps({
        callModel: vi.fn().mockResolvedValue({
          ok: true,
          riskClassification: "none",
          message: "OK",
        }),
      });

      const result = await runDirectorTurn(buildInput(), deps);

      expect(result.ok).toBe(true);
      expect(result.errorCode).toBeUndefined();
    });

    it("geeft DirectorErrorCode.UNKNOWN terug bij een onbekende/onverwerkte fout, zonder te vertrouwen op tekstherkenning", async () => {
      const deps = buildDeps({
        callModel: vi.fn().mockRejectedValue(new Error("Netwerkfout")),
      });

      const result = await runDirectorTurn(buildInput(), deps);

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe(DirectorErrorCode.UNKNOWN);
    });

    it("roept de gemockte callModel-dependency precies één keer aan per turn", async () => {
      const callModel = vi.fn().mockResolvedValue({
        ok: true,
        riskClassification: "none",
        message: "OK",
      });
      const deps = buildDeps({ callModel });

      await runDirectorTurn(buildInput(), deps);

      expect(callModel).toHaveBeenCalledTimes(1);
    });

    it("logt een waarschuwing via de gemockte logger wanneer NEEDS_SIGNOFF wordt geretourneerd", async () => {
      const warn = vi.fn();
      const deps = buildDeps({
        callModel: vi.fn().mockResolvedValue({
          ok: false,
          riskClassification: "needs-signoff",
          message: "Blokkade door risicoclassificatie.",
        }),
        logger: {
          info: vi.fn(),
          warn,
          error: vi.fn(),
        },
      });

      await runDirectorTurn(buildInput(), deps);

      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});