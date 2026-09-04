import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * role-runtime.ts routeert een roluitvoering naar één van drie paden:
 * - roleId "builder" -> executeBuilderAssignment (./builder-runtime)
 * - roleId "qa"      -> executeQaAssignment (./qa-runtime)
 * - elke andere rol  -> een directe LLM-aanroep via getChatProvider
 *   (@/core/llm/model-router) en diens chatCompletion.
 *
 * Alle drie de modules worden hier gemockt, zodat deze tests uitsluitend het
 * routeringsgedrag en het vastleggen van het resultaat verifiëren, zonder een
 * echte builder-/QA-run of een echte LLM-aanroep te doen.
 */
vi.mock("./builder-runtime", () => ({
  executeBuilderAssignment: vi.fn(),
}));

vi.mock("./qa-runtime", () => ({
  executeQaAssignment: vi.fn(),
}));

/**
 * getChatProvider geeft normaal een provider-object terug waarop
 * chatCompletion wordt aangeroepen. De mock geeft bewust telkens dezelfde
 * chatCompletion-mock terug (aangemaakt binnen de mock-factory), zodat een
 * test die de provider opnieuw opvraagt exact dezelfde spy ziet als de code
 * onder test gebruikt heeft.
 */
vi.mock("@/core/llm/model-router", () => {
  const chatCompletion = vi.fn();
  return {
    getChatProvider: vi.fn(() => ({ chatCompletion })),
  };
});

import { executeRoleAssignment } from "./role-runtime";
import { executeBuilderAssignment } from "./builder-runtime";
import { executeQaAssignment } from "./qa-runtime";
import { getChatProvider } from "@/core/llm/model-router";

type MockFn = ReturnType<typeof vi.fn>;

/**
 * Haalt de gedeelde chatCompletion-mock op uit de gemockte provider-factory.
 * De cast is nodig omdat we hier alleen de mock-vorm gebruiken en niet de
 * echte provider-signatuur nabouwen.
 */
function getChatCompletionMock(): MockFn {
  const provider = (getChatProvider as unknown as () => { chatCompletion: MockFn })();
  return provider.chatCompletion;
}

/**
 * Minimale engine-stub met exact de drie methodes die executeRoleAssignment
 * gebruikt: getMission (ophalen van de missie), recordRoleResult (vastleggen
 * van het rolresultaat) en evaluateCriterion (toepassen van QA-verdicts).
 */
function createTestEngine(mission: unknown) {
  return {
    getMission: vi.fn().mockResolvedValue(mission as never),
    recordRoleResult: vi.fn().mockResolvedValue(undefined as never),
    evaluateCriterion: vi.fn().mockResolvedValue(undefined as never),
  };
}

/**
 * Bouwt een missie met één assignment. Alleen de velden die de routering
 * daadwerkelijk raakt zijn ingevuld — vandaar dat het object als testfixture
 * wordt doorgegeven en niet als volledig missie-type wordt nagebouwd.
 */
function buildMission(options: {
  missionId?: string;
  assignmentId?: string;
  roleId?: string;
  status?: string;
}) {
  const {
    missionId = "mission-1",
    assignmentId = "assignment-1",
    roleId = "builder",
    status = "ACTIVE",
  } = options;

  return {
    missionId,
    ownerId: "owner-1",
    status: "ACTIVE",
    title: "Testmissie",
    assignments: [
      {
        assignmentId,
        missionId,
        roleId,
        status,
        title: `Toewijzing voor rol ${roleId}`,
        instructions: "Voer de toewijzing uit.",
      },
    ],
  };
}

/**
 * Roept de functie onder test aan. De cast houdt de tests leesbaar zonder de
 * volledige engine- en missietypes in elke test te hoeven nabouwen.
 */
async function runRoleAssignment(
  engine: ReturnType<typeof createTestEngine>,
  missionId: string,
  assignmentId: string,
) {
  return executeRoleAssignment({ engine, missionId, assignmentId } as never);
}

/**
 * evaluateCriterion kan het criterium en het oordeel als losse argumenten of
 * gebundeld in één object ontvangen. Deze helper controleert tolerant of een
 * concrete aanroep zowel het verwachte criterionId als de verwachte
 * passed-waarde bevat, zonder aan één specifieke argumentvolgorde vast te
 * zitten.
 */
function callMatchesVerdict(args: unknown[], criterionId: string, passed: boolean): boolean {
  const mentionsCriterion = args.some((arg) => {
    if (typeof arg === "string") {
      return arg === criterionId;
    }
    if (arg && typeof arg === "object") {
      return (arg as Record<string, unknown>).criterionId === criterionId;
    }
    return false;
  });

  const mentionsVerdict = args.some((arg) => {
    if (typeof arg === "boolean") {
      return arg === passed;
    }
    if (arg && typeof arg === "object") {
      return (arg as Record<string, unknown>).passed === passed;
    }
    return false;
  });

  return mentionsCriterion && mentionsVerdict;
}

describe("executeRoleAssignment", () => {
  let chatCompletion: MockFn;

  beforeEach(() => {
    vi.clearAllMocks();
    chatCompletion = getChatCompletionMock();
    chatCompletion.mockResolvedValue({ content: "Onderzoeksuitkomst" } as never);
  });

  it("routeert roleId 'builder' naar executeBuilderAssignment, niet naar de QA-runtime, en legt het resultaat vast via engine.recordRoleResult", async () => {
    const mission = buildMission({ roleId: "builder" });
    const engine = createTestEngine(mission);

    const builderResult = {
      roleId: "builder",
      assignmentId: "assignment-1",
      summary: "Builder heeft de wijziging doorgevoerd",
    };
    vi.mocked(executeBuilderAssignment).mockResolvedValue(builderResult as never);

    await runRoleAssignment(engine, "mission-1", "assignment-1");

    expect(executeBuilderAssignment).toHaveBeenCalledTimes(1);
    expect(executeQaAssignment).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();

    expect(engine.recordRoleResult).toHaveBeenCalledTimes(1);
    expect(engine.recordRoleResult.mock.calls[0]).toContainEqual(
      expect.objectContaining({
        roleId: "builder",
        summary: "Builder heeft de wijziging doorgevoerd",
      }),
    );
  });

  it("routeert roleId 'qa' naar executeQaAssignment en past elk teruggegeven criteriaVerdict exact één keer toe via engine.evaluateCriterion", async () => {
    const mission = buildMission({ roleId: "qa", assignmentId: "assignment-qa" });
    const engine = createTestEngine(mission);

    const qaResult = {
      roleId: "qa",
      assignmentId: "assignment-qa",
      summary: "QA-controle uitgevoerd",
      criteriaVerdicts: [
        { criterionId: "criterion-1", passed: true },
        { criterionId: "criterion-2", passed: false },
      ],
    };
    vi.mocked(executeQaAssignment).mockResolvedValue(qaResult as never);

    await runRoleAssignment(engine, "mission-1", "assignment-qa");

    expect(executeQaAssignment).toHaveBeenCalledTimes(1);
    expect(executeBuilderAssignment).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();

    expect(engine.recordRoleResult).toHaveBeenCalledTimes(1);

    // Eén evaluateCriterion-aanroep per verdict, met het juiste criterionId
    // en de bijbehorende passed-waarde (inclusief het falende criterium).
    const calls = engine.evaluateCriterion.mock.calls;
    expect(calls).toHaveLength(2);
    expect(
      calls.filter((args) => callMatchesVerdict(args, "criterion-1", true)),
    ).toHaveLength(1);
    expect(
      calls.filter((args) => callMatchesVerdict(args, "criterion-2", false)),
    ).toHaveLength(1);
  });

  it("gebruikt voor een andere rol (researcher) de LLM-provider en roept noch de builder- noch de QA-runtime aan", async () => {
    const mission = buildMission({ roleId: "researcher", assignmentId: "assignment-research" });
    const engine = createTestEngine(mission);

    await runRoleAssignment(engine, "mission-1", "assignment-research");

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(executeBuilderAssignment).not.toHaveBeenCalled();
    expect(executeQaAssignment).not.toHaveBeenCalled();

    expect(engine.recordRoleResult).toHaveBeenCalledTimes(1);
    expect(engine.evaluateCriterion).not.toHaveBeenCalled();
  });

  it("gooit een fout wanneer engine.getMission null teruggeeft en legt dan niets vast", async () => {
    const engine = createTestEngine(null);

    await expect(runRoleAssignment(engine, "mission-onbekend", "assignment-1")).rejects.toThrow();

    expect(engine.getMission).toHaveBeenCalledTimes(1);
    expect(engine.recordRoleResult).not.toHaveBeenCalled();
    expect(engine.evaluateCriterion).not.toHaveBeenCalled();
    expect(executeBuilderAssignment).not.toHaveBeenCalled();
    expect(executeQaAssignment).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("gooit een fout wanneer de opgegeven assignmentId niet bestaat en legt dan niets vast", async () => {
    const mission = buildMission({ assignmentId: "assignment-1" });
    const engine = createTestEngine(mission);

    await expect(runRoleAssignment(engine, "mission-1", "assignment-bestaat-niet")).rejects.toThrow();

    expect(engine.recordRoleResult).not.toHaveBeenCalled();
    expect(engine.evaluateCriterion).not.toHaveBeenCalled();
    expect(executeBuilderAssignment).not.toHaveBeenCalled();
    expect(executeQaAssignment).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("gooit een fout wanneer de gevonden assignment niet de status ACTIVE heeft en legt dan niets vast", async () => {
    const mission = buildMission({ assignmentId: "assignment-1", status: "DONE" });
    const engine = createTestEngine(mission);

    await expect(runRoleAssignment(engine, "mission-1", "assignment-1")).rejects.toThrow();

    expect(engine.recordRoleResult).not.toHaveBeenCalled();
    expect(engine.evaluateCriterion).not.toHaveBeenCalled();
    expect(executeBuilderAssignment).not.toHaveBeenCalled();
    expect(executeQaAssignment).not.toHaveBeenCalled();
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});