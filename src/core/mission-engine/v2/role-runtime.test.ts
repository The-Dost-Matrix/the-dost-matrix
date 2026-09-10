import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * executeRoleAssignment routeert een toewijzing naar één van drie paden:
 * roleId "builder" → executeBuilderAssignment (./builder-runtime), roleId
 * "qa" → executeQaAssignment (./qa-runtime), en elke andere rol → een
 * directe LLM-aanroep via getChatProvider (@/core/llm/model-router). Die drie
 * worden hier gemockt; het engine-object wordt als stub meegegeven.
 *
 * Drie details komen rechtstreeks uit de echte broncode en zijn precies waar
 * een eerdere poging tot dit testbestand op stukliep:
 * - executeBuilderAssignment geeft `{ result, roleOutput }` terug en
 *   executeQaAssignment `{ result, roleOutput, criteriaVerdicts }` — niet een
 *   plat resultaatobject. Zonder `result` valt de rest van de functie om.
 * - engine.recordRoleResult en engine.evaluateCriterion geven allebei de
 *   BIJGEWERKTE missie terug; die versie wordt hergebruikt als
 *   `expectedTargetVersion` van de volgende aanroep. Een stub die `undefined`
 *   teruggeeft, breekt daarom bij het tweede verdict.
 * - Beide engine-methodes krijgen één commando-object mee, met de inhoud in
 *   `payload` — geen losse argumenten.
 */
vi.mock("./builder-runtime", () => ({
  executeBuilderAssignment: vi.fn(),
}));

vi.mock("./qa-runtime", () => ({
  executeQaAssignment: vi.fn(),
}));

const chatCompletion = vi.fn();

vi.mock("@/core/llm/model-router", () => ({
  getChatProvider: vi.fn(),
}));

import { getChatProvider } from "@/core/llm/model-router";

import { executeBuilderAssignment } from "./builder-runtime";
import { executeQaAssignment } from "./qa-runtime";
import { executeRoleAssignment } from "./role-runtime";

function buildMission(
  overrides: { roleId?: string; assignmentStatus?: string } = {},
): Record<string, unknown> {
  const { roleId = "builder", assignmentStatus = "ACTIVE" } = overrides;

  return {
    missionId: "mission-1",
    version: 1,
    ownerId: "owner-1",
    title: "Testmissie",
    objective: "Iets nuttigs opleveren.",
    constraints: ["Verander geen productiecode."],
    assignments: [
      {
        assignmentId: "assignment-1",
        missionId: "mission-1",
        roleId,
        status: assignmentStatus,
        objective: "Voer de toewijzing uit.",
        successCriteria: ["Criterium één", "Criterium twee"],
      },
    ],
  };
}

/**
 * Elke engine-methode geeft een missie met een OPGEHOOGDE version terug,
 * zodat ook het doorgeven van expectedTargetVersion tussen opeenvolgende
 * aanroepen getest kan worden.
 */
function createEngineStub(mission: unknown) {
  let version = 1;
  const nextMission = () => ({ ...(mission as Record<string, unknown>), version: ++version });

  return {
    getMission: vi.fn().mockResolvedValue(mission),
    recordRoleResult: vi.fn().mockImplementation(async () => nextMission()),
    evaluateCriterion: vi.fn().mockImplementation(async () => nextMission()),
  };
}

function roleResult(overrides: Record<string, unknown> = {}) {
  return {
    resultId: "result-1",
    assignmentId: "assignment-1",
    missionId: "mission-1",
    status: "COMPLETED",
    summary: "Klaar.",
    ...overrides,
  };
}

function run(engine: ReturnType<typeof createEngineStub>, assignmentId = "assignment-1") {
  return executeRoleAssignment({
    engine,
    missionId: "mission-1",
    assignmentId,
  } as never);
}

describe("executeRoleAssignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getChatProvider).mockReturnValue({
      id: "test-provider",
      chatCompletion,
    } as never);
    chatCompletion.mockResolvedValue({
      content: "Uitkomst van de rol.",
      model: "test-model",
    });
  });

  it("routeert 'builder' naar executeBuilderAssignment en legt dat resultaat vast", async () => {
    const mission = buildMission({ roleId: "builder" });
    const engine = createEngineStub(mission);
    const result = roleResult({ summary: "Builder heeft de wijziging doorgevoerd." });

    vi.mocked(executeBuilderAssignment).mockResolvedValue({
      result,
      roleOutput: "Pull request geopend.",
    } as never);

    const outcome = await run(engine);

    expect(executeBuilderAssignment).toHaveBeenCalledTimes(1);
    expect(executeBuilderAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        mission,
        assignment: expect.objectContaining({ assignmentId: "assignment-1", roleId: "builder" }),
      }),
    );
    expect(executeQaAssignment).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();

    expect(engine.recordRoleResult).toHaveBeenCalledTimes(1);
    expect(engine.recordRoleResult).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: "RecordRoleResult",
        targetId: "mission-1",
        expectedTargetVersion: 1,
        payload: { result },
      }),
    );
    expect(engine.evaluateCriterion).not.toHaveBeenCalled();
    expect(outcome.roleOutput).toBe("Pull request geopend.");
  });

  it("routeert 'qa' naar executeQaAssignment en past elk verdict exact één keer toe", async () => {
    const mission = buildMission({ roleId: "qa" });
    const engine = createEngineStub(mission);

    vi.mocked(executeQaAssignment).mockResolvedValue({
      result: roleResult({ resultId: "qa-result-1" }),
      roleOutput: "QA-oordeel.",
      criteriaVerdicts: [
        { criterionId: "criterion-1", outcome: "PASSED", reason: "Voldoet." },
        { criterionId: "criterion-2", outcome: "FAILED", reason: "Voldoet niet." },
      ],
    } as never);

    await run(engine);

    expect(executeQaAssignment).toHaveBeenCalledTimes(1);
    expect(executeBuilderAssignment).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(engine.recordRoleResult).toHaveBeenCalledTimes(1);

    expect(engine.evaluateCriterion).toHaveBeenCalledTimes(2);
    expect(engine.evaluateCriterion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        commandType: "EvaluateMissionCriterion",
        targetId: "mission-1",
        payload: expect.objectContaining({
          criterionId: "criterion-1",
          outcome: "PASSED",
          note: "Voldoet.",
          evidenceRefs: ["qa-result-1"],
        }),
      }),
    );
    expect(engine.evaluateCriterion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: expect.objectContaining({ criterionId: "criterion-2", outcome: "FAILED" }),
      }),
    );
  });

  it("past een ONDUIDELIJK (UNDETERMINED) verdict toe zonder het als gehaald te tellen", async () => {
    // Stap 12b: QA mag ook zeggen dat ze een criterium niet kan vaststellen.
    // role-runtime.ts moet dat verdict ongewijzigd doorgeven aan de engine —
    // niet stilzwijgend afronden naar PASSED of FAILED.
    const mission = buildMission({ roleId: "qa" });
    const engine = createEngineStub(mission);

    vi.mocked(executeQaAssignment).mockResolvedValue({
      result: roleResult({ resultId: "qa-result-2" }),
      roleOutput: "QA-oordeel.",
      criteriaVerdicts: [
        { criterionId: "criterion-1", outcome: "UNDETERMINED", reason: "Niet vast te stellen." },
      ],
    } as never);

    await run(engine);

    expect(engine.evaluateCriterion).toHaveBeenCalledTimes(1);
    expect(engine.evaluateCriterion).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          criterionId: "criterion-1",
          outcome: "UNDETERMINED",
          note: "Niet vast te stellen.",
        }),
      }),
    );
  });

  it("gebruikt de versie van de vorige aanroep als expectedTargetVersion bij elk volgend verdict", async () => {
    const mission = buildMission({ roleId: "qa" });
    const engine = createEngineStub(mission);

    vi.mocked(executeQaAssignment).mockResolvedValue({
      result: roleResult(),
      roleOutput: "QA-oordeel.",
      criteriaVerdicts: [
        { criterionId: "criterion-1", outcome: "PASSED", reason: "Voldoet." },
        { criterionId: "criterion-2", outcome: "PASSED", reason: "Voldoet ook." },
      ],
    } as never);

    await run(engine);

    // recordRoleResult gaf version 2 terug, de eerste evaluateCriterion version 3.
    expect(engine.evaluateCriterion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ expectedTargetVersion: 2 }),
    );
    expect(engine.evaluateCriterion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ expectedTargetVersion: 3 }),
    );
  });

  it("gebruikt voor een andere rol de LLM-provider en evalueert geen criteria", async () => {
    const mission = buildMission({ roleId: "researcher" });
    const engine = createEngineStub(mission);

    const outcome = await run(engine);

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(executeBuilderAssignment).not.toHaveBeenCalled();
    expect(executeQaAssignment).not.toHaveBeenCalled();

    expect(engine.recordRoleResult).toHaveBeenCalledTimes(1);
    expect(engine.recordRoleResult).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          result: expect.objectContaining({
            status: "COMPLETED",
            summary: "Uitkomst van de rol.",
            deliverables: ["Uitkomst van de rol."],
          }),
        }),
      }),
    );
    expect(engine.evaluateCriterion).not.toHaveBeenCalled();
    expect(outcome.roleOutput).toBe("Uitkomst van de rol.");
  });

  it("gooit een fout wanneer de missie niet bestaat, en legt niets vast", async () => {
    const engine = createEngineStub(null);

    await expect(run(engine)).rejects.toThrow(/bestaat niet/i);

    expect(engine.recordRoleResult).not.toHaveBeenCalled();
    expect(engine.evaluateCriterion).not.toHaveBeenCalled();
    expect(executeBuilderAssignment).not.toHaveBeenCalled();
    expect(executeQaAssignment).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("gooit een fout wanneer de assignmentId niet bestaat, en legt niets vast", async () => {
    const engine = createEngineStub(buildMission());

    await expect(run(engine, "assignment-bestaat-niet")).rejects.toThrow(/niet actief/i);

    expect(engine.recordRoleResult).not.toHaveBeenCalled();
    expect(executeBuilderAssignment).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("gooit een fout wanneer de assignment niet de status ACTIVE heeft, en legt niets vast", async () => {
    const engine = createEngineStub(buildMission({ assignmentStatus: "COMPLETED" }));

    await expect(run(engine)).rejects.toThrow(/niet actief/i);

    expect(engine.recordRoleResult).not.toHaveBeenCalled();
    expect(executeBuilderAssignment).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
