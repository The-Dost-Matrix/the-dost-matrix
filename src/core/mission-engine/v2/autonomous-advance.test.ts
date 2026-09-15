import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Deze module praat met vier losse afhankelijkheden: de Director-runtime
 * (beslissingen nemen + mergen), de Role-runtime (een toewijzing echt
 * uitvoeren), de Firestore-store (missies ophalen) en de engine-factory
 * (een MissionEngine-instantie). Alle vier worden hier volledig gemockt —
 * net als in director-runtime.ensureMissionPullRequestMerged.test.ts wordt
 * hiermee voorkomen dat deze tests per ongeluk de echte Firebase Admin SDK
 * of GitHub API raken, en kunnen we het batch-gedrag (welke missie krijgt
 * hoeveel stappen, wanneer stopt de lus) geïsoleerd testen.
 */
vi.mock("./director-runtime", () => ({
  runDirectorStep: vi.fn(),
  DirectorRuntimeError: class DirectorRuntimeError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "DirectorRuntimeError";
      this.code = code;
    }
  },
}));

vi.mock("./role-runtime", () => ({
  executeRoleAssignment: vi.fn(),
}));

vi.mock("./firestore-store", () => ({
  listMissionsForOwner: vi.fn(),
}));

vi.mock("./engine-factory", () => ({
  createMissionEngineV2: vi.fn(() => ({})),
}));

/**
 * Sinds 15 september 2026 wacht de lus na een builder-stap binnen dezelfde
 * aanroep op de CI (zie ci-wait.ts). Die module praat met GitHub en wordt
 * hier volledig gemockt: wat deze tests moeten vaststellen is wat de lus met
 * elke uitkomst DOET, niet of het wachten zelf werkt — dat staat in
 * ci-wait.test.ts.
 */
vi.mock("./ci-wait", () => ({
  waitForMissionChecks: vi.fn(async () => "TIMED_OUT"),
}));

import { waitForMissionChecks } from "./ci-wait";
import { runDirectorStep, DirectorRuntimeError } from "./director-runtime";
import { executeRoleAssignment } from "./role-runtime";
import { listMissionsForOwner } from "./firestore-store";
import { advanceMissionsForOwner } from "./autonomous-advance";
import type { MissionV2, MissionStatus } from "./mission";
import type { DirectorDecision } from "@/core/contracts/v2";

function buildMission(overrides: Partial<MissionV2> = {}): MissionV2 {
  return {
    missionId: "mission-1",
    ownerId: "owner-1",
    title: "Voorbeeldmissie",
    objective: "Iets bouwen.",
    status: "ACTIVE" as MissionStatus,
    activeAssignmentIds: [],
    assignments: [],
    ...overrides,
  } as unknown as MissionV2;
}

/**
 * Een toewijzing zoals die in `mission.assignments` staat. Alleen de twee
 * velden die deze module echt leest — de rest van MissionAssignmentRecord is
 * hier niet van belang en zou de tests alleen maar ruis geven.
 */
function buildAssignment(assignmentId: string, roleId: string) {
  return { assignmentId, roleId } as unknown as MissionV2["assignments"][number];
}

function buildDecision(overrides: Partial<DirectorDecision> = {}): DirectorDecision {
  return {
    decisionId: "decision-1",
    missionId: "mission-1",
    decisionType: "DISPATCH_ROLE",
    reason: "Verder bouwen.",
    nextAction: "Verder bouwen.",
    assignedRole: "builder",
    requiredCapabilities: [],
    contextRequirements: [],
    modelConstraints: {},
    approvalRequirement: "none",
    successCriteria: [],
    failureStrategy: "Bij falen opnieuw plannen (REPLANNING).",
    createdAt: new Date().toISOString(),
    ...overrides,
  } as unknown as DirectorDecision;
}

const farFutureDeadline = () => Date.now() + 60_000;

describe("advanceMissionsForOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Standaard: het wachten op de CI levert binnen deze aanroep niets op, dus
    // geldt het oorspronkelijke gedrag (pauzeren tot de volgende tik).
    vi.mocked(waitForMissionChecks).mockResolvedValue("TIMED_OUT");
  });

  it("negeert missies die niet ACTIVE of WAITING_FOR_ROLE zijn", async () => {
    vi.mocked(listMissionsForOwner).mockResolvedValue([
      buildMission({ missionId: "m-done", status: "COMPLETED" as MissionStatus }),
      buildMission({ missionId: "m-wait-owner", status: "WAITING_FOR_OWNER" as MissionStatus }),
    ]);

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: farFutureDeadline() });

    expect(result.consideredMissions).toBe(0);
    expect(result.outcomes).toHaveLength(0);
    expect(runDirectorStep).not.toHaveBeenCalled();
  });

  it("laat een ACTIVE missie doorlopen tot de Director COMPLETE_MISSION beslist", async () => {
    const mission = buildMission({ status: "ACTIVE" as MissionStatus, activeAssignmentIds: ["a1"] });
    vi.mocked(listMissionsForOwner).mockResolvedValue([mission]);

    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission: { ...mission, activeAssignmentIds: ["a1"] },
      decision: buildDecision({ decisionType: "DISPATCH_ROLE" }),
      usedKnowledge: [],
    });
    vi.mocked(executeRoleAssignment).mockResolvedValueOnce({
      mission: { ...mission, status: "ACTIVE" as MissionStatus, activeAssignmentIds: [] },
      roleOutput: "klaar",
    } as never);
    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission: { ...mission, status: "COMPLETED" as MissionStatus, activeAssignmentIds: [] },
      decision: buildDecision({ decisionType: "COMPLETE_MISSION" }),
      usedKnowledge: [],
    });

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: farFutureDeadline() });

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].endStatus).toBe("COMPLETED");
    expect(result.outcomes[0].stoppedReason).toBe("TERMINAL_OR_WAITING_STATUS");
    expect(result.outcomes[0].stepsTaken).toBe(1);
  });

  it("stopt een missie zodra hij WAITING_FOR_OWNER wordt, zonder de rest te blokkeren", async () => {
    const missionA = buildMission({ missionId: "m-a", activeAssignmentIds: ["a1"] });
    const missionB = buildMission({ missionId: "m-b", activeAssignmentIds: ["a2"] });
    vi.mocked(listMissionsForOwner).mockResolvedValue([missionA, missionB]);

    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission: { ...missionA, status: "WAITING_FOR_OWNER" as MissionStatus },
      decision: buildDecision({ decisionType: "REQUEST_OWNER_INPUT" as DirectorDecision["decisionType"] }),
      usedKnowledge: [],
    });
    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission: { ...missionB, status: "COMPLETED" as MissionStatus, activeAssignmentIds: [] },
      decision: buildDecision({ decisionType: "COMPLETE_MISSION" }),
      usedKnowledge: [],
    });

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: farFutureDeadline() });

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0].endStatus).toBe("WAITING_FOR_OWNER");
    expect(result.outcomes[0].stepsTaken).toBe(0);
    expect(result.outcomes[1].endStatus).toBe("COMPLETED");
  });

  it("vangt een DirectorRuntimeError (bijv. NEEDS_SIGNOFF) op als resultaat i.p.v. de hele batch te laten crashen", async () => {
    const mission = buildMission({ activeAssignmentIds: [] });
    vi.mocked(listMissionsForOwner).mockResolvedValue([mission]);

    vi.mocked(runDirectorStep).mockRejectedValueOnce(
      new DirectorRuntimeError("NEEDS_SIGNOFF", "De geautomatiseerde beoordeling durfde dit niet goed te keuren."),
    );

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: farFutureDeadline() });

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].stoppedReason).toBe("DIRECTOR_ERROR");
    expect(result.outcomes[0].errorCode).toBe("NEEDS_SIGNOFF");
  });

  it("respecteert de tijdslimiet en stopt met stoppedReason DEADLINE_REACHED", async () => {
    const mission = buildMission({ activeAssignmentIds: [] });
    vi.mocked(listMissionsForOwner).mockResolvedValue([mission]);

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: Date.now() - 1 });

    expect(result.deadlineReachedBeforeAllDone).toBe(true);
    expect(result.outcomes[0].stoppedReason).toBe("DEADLINE_REACHED");
    expect(runDirectorStep).not.toHaveBeenCalled();
  });

  it("stopt een missie bij het bereiken van maxStepsPerMission, ook als de Director door wil gaan", async () => {
    const mission = buildMission({ activeAssignmentIds: ["a1"] });
    vi.mocked(listMissionsForOwner).mockResolvedValue([mission]);

    vi.mocked(runDirectorStep).mockResolvedValue({
      mission: { ...mission, activeAssignmentIds: ["a1"] },
      decision: buildDecision({ decisionType: "DISPATCH_ROLE" }),
      usedKnowledge: [],
    });
    vi.mocked(executeRoleAssignment).mockResolvedValue({
      mission: { ...mission, status: "ACTIVE" as MissionStatus, activeAssignmentIds: [] },
      roleOutput: "klaar",
    } as never);

    const result = await advanceMissionsForOwner("owner-1", {
      deadlineAt: farFutureDeadline(),
      maxStepsPerMission: 2,
    });

    expect(result.outcomes[0].stoppedReason).toBe("STEP_LIMIT_REACHED");
    expect(result.outcomes[0].stepsTaken).toBe(2);
  });

  /**
   * De kern van de wijziging van 14 september 2026. Zie de toelichting
   * bovenaan autonomous-advance.ts: liep de lus na een builder-stap door,
   * dan beoordeelde QA een commit waarvoor GitHub nog geen enkele check-run
   * had geregistreerd — en "geen check-runs" betekent in
   * getCombinedCheckStatus bewust "niet blokkeren".
   */
  it("stopt na een builder-toewijzing, zodat de CI eerst kan draaien", async () => {
    const mission = buildMission({
      activeAssignmentIds: ["a1"],
      assignments: [buildAssignment("a1", "builder")],
    });
    vi.mocked(listMissionsForOwner).mockResolvedValue([mission]);

    vi.mocked(runDirectorStep).mockResolvedValue({
      mission,
      decision: buildDecision({ decisionType: "DISPATCH_ROLE" }),
      usedKnowledge: [],
    });
    vi.mocked(executeRoleAssignment).mockResolvedValue({
      mission: { ...mission, status: "ACTIVE" as MissionStatus, activeAssignmentIds: [] },
      roleOutput: "pull request geopend",
    } as never);

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: farFutureDeadline() });

    expect(result.outcomes[0].stoppedReason).toBe("WAITING_FOR_CI");
    expect(result.outcomes[0].stepsTaken).toBe(1);
    // Eén keer uitgevoerd, en daarna geen nieuwe Director-beslissing meer:
    // dat tweede besluit is precies wat op een nog niet bestaande CI-uitslag
    // zou zijn genomen.
    expect(executeRoleAssignment).toHaveBeenCalledTimes(1);
    expect(runDirectorStep).toHaveBeenCalledTimes(1);
  });

  it("stopt ook na een builder-toewijzing die via WAITING_FOR_ROLE binnenkomt", async () => {
    // Deze tak wordt gebruikt wanneer een vorige tik de toewijzing al had
    // klaargezet maar niet meer kon uitvoeren.
    const mission = buildMission({
      status: "WAITING_FOR_ROLE" as MissionStatus,
      activeAssignmentIds: ["a1"],
      assignments: [buildAssignment("a1", "builder")],
    });
    vi.mocked(listMissionsForOwner).mockResolvedValue([mission]);

    vi.mocked(executeRoleAssignment).mockResolvedValue({
      mission: { ...mission, status: "ACTIVE" as MissionStatus, activeAssignmentIds: [] },
      roleOutput: "pull request bijgewerkt",
    } as never);

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: farFutureDeadline() });

    expect(result.outcomes[0].stoppedReason).toBe("WAITING_FOR_CI");
    expect(runDirectorStep).not.toHaveBeenCalled();
  });

  /**
   * De versnelling van 15 september 2026. De pauze blijft de garantie; dit
   * bepaalt alleen of hij twee minuten duurt of tot de volgende tik — en die
   * tik bleek in de praktijk uren weg te kunnen zijn.
   */
  it("gaat in dezelfde tik door wanneer de CI op tijd klaar is", async () => {
    vi.mocked(waitForMissionChecks).mockResolvedValue("SETTLED");

    const mission = buildMission({
      activeAssignmentIds: ["a1"],
      assignments: [buildAssignment("a1", "builder")],
    });
    vi.mocked(listMissionsForOwner).mockResolvedValue([mission]);

    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission,
      decision: buildDecision({ decisionType: "DISPATCH_ROLE" }),
      usedKnowledge: [],
    });
    vi.mocked(executeRoleAssignment).mockResolvedValueOnce({
      mission: { ...mission, status: "ACTIVE" as MissionStatus, activeAssignmentIds: [] },
      roleOutput: "pull request geopend",
    } as never);
    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission: { ...mission, status: "COMPLETED" as MissionStatus, activeAssignmentIds: [] },
      decision: buildDecision({ decisionType: "COMPLETE_MISSION" }),
      usedKnowledge: [],
    });

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: farFutureDeadline() });

    expect(result.outcomes[0].stoppedReason).toBe("TERMINAL_OR_WAITING_STATUS");
    expect(result.outcomes[0].endStatus).toBe("COMPLETED");
  });

  it("gaat ook door wanneer er niets te wachten valt", async () => {
    // Een builder-stap die niets committe, laat geen pull request achter.
    vi.mocked(waitForMissionChecks).mockResolvedValue("NO_PULL_REQUEST");

    const mission = buildMission({
      activeAssignmentIds: ["a1"],
      assignments: [buildAssignment("a1", "builder")],
    });
    vi.mocked(listMissionsForOwner).mockResolvedValue([mission]);

    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission,
      decision: buildDecision({ decisionType: "DISPATCH_ROLE" }),
      usedKnowledge: [],
    });
    vi.mocked(executeRoleAssignment).mockResolvedValueOnce({
      mission: { ...mission, status: "ACTIVE" as MissionStatus, activeAssignmentIds: [] },
      roleOutput: "niets gewijzigd",
    } as never);
    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission: { ...mission, status: "COMPLETED" as MissionStatus, activeAssignmentIds: [] },
      decision: buildDecision({ decisionType: "COMPLETE_MISSION" }),
      usedKnowledge: [],
    });

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: farFutureDeadline() });

    expect(result.outcomes[0].stoppedReason).toBe("TERMINAL_OR_WAITING_STATUS");
  });

  it("pauzeert wanneer de CI-stand niet opgehaald kan worden", async () => {
    // Doorgaan zou betekenen: opnieuw oordelen op een onbekende CI-stand, en
    // dat is precies de bug waar de pauze voor gebouwd is.
    vi.mocked(waitForMissionChecks).mockResolvedValue("ERROR");

    const mission = buildMission({
      activeAssignmentIds: ["a1"],
      assignments: [buildAssignment("a1", "builder")],
    });
    vi.mocked(listMissionsForOwner).mockResolvedValue([mission]);

    vi.mocked(runDirectorStep).mockResolvedValue({
      mission,
      decision: buildDecision({ decisionType: "DISPATCH_ROLE" }),
      usedKnowledge: [],
    });
    vi.mocked(executeRoleAssignment).mockResolvedValue({
      mission: { ...mission, status: "ACTIVE" as MissionStatus, activeAssignmentIds: [] },
      roleOutput: "pull request geopend",
    } as never);

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: farFutureDeadline() });

    expect(result.outcomes[0].stoppedReason).toBe("WAITING_FOR_CI");
  });

  it("stopt NIET na een qa-toewijzing — die schrijft geen code", async () => {
    // De pauze hoort alleen te gelden voor stappen die een commit opleveren.
    // Zou hij ook na QA gelden, dan kostte elke missie onnodig extra tikken.
    const mission = buildMission({
      activeAssignmentIds: ["a1"],
      assignments: [buildAssignment("a1", "qa")],
    });
    vi.mocked(listMissionsForOwner).mockResolvedValue([mission]);

    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission,
      decision: buildDecision({ decisionType: "DISPATCH_ROLE", assignedRole: "qa" }),
      usedKnowledge: [],
    });
    vi.mocked(executeRoleAssignment).mockResolvedValueOnce({
      mission: { ...mission, status: "ACTIVE" as MissionStatus, activeAssignmentIds: [] },
      roleOutput: "beoordeeld",
    } as never);
    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission: { ...mission, status: "COMPLETED" as MissionStatus, activeAssignmentIds: [] },
      decision: buildDecision({ decisionType: "COMPLETE_MISSION" }),
      usedKnowledge: [],
    });

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: farFutureDeadline() });

    expect(result.outcomes[0].stoppedReason).toBe("TERMINAL_OR_WAITING_STATUS");
    expect(result.outcomes[0].endStatus).toBe("COMPLETED");
  });

  it("pauzeert niet wanneer de rol van de toewijzing onbekend is", async () => {
    // Fail-open: een missie zonder bruikbare toewijzingenlijst mag niet
    // blijven hangen op een veld dat er niet is.
    const mission = buildMission({ activeAssignmentIds: ["a1"], assignments: [] });
    vi.mocked(listMissionsForOwner).mockResolvedValue([mission]);

    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission,
      decision: buildDecision({ decisionType: "DISPATCH_ROLE" }),
      usedKnowledge: [],
    });
    vi.mocked(executeRoleAssignment).mockResolvedValueOnce({
      mission: { ...mission, status: "ACTIVE" as MissionStatus, activeAssignmentIds: [] },
      roleOutput: "klaar",
    } as never);
    vi.mocked(runDirectorStep).mockResolvedValueOnce({
      mission: { ...mission, status: "COMPLETED" as MissionStatus, activeAssignmentIds: [] },
      decision: buildDecision({ decisionType: "COMPLETE_MISSION" }),
      usedKnowledge: [],
    });

    const result = await advanceMissionsForOwner("owner-1", { deadlineAt: farFutureDeadline() });

    expect(result.outcomes[0].stoppedReason).toBe("TERMINAL_OR_WAITING_STATUS");
  });

  it("beperkt hoeveel kandidaat-missies bekeken worden via maxMissionsConsidered", async () => {
    vi.mocked(listMissionsForOwner).mockResolvedValue([]);

    await advanceMissionsForOwner("owner-1", {
      deadlineAt: farFutureDeadline(),
      maxMissionsConsidered: 7,
    });

    expect(listMissionsForOwner).toHaveBeenCalledWith("owner-1", 7);
  });
});
