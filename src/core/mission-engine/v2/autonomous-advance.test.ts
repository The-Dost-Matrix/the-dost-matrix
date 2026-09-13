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
    ...overrides,
  } as unknown as MissionV2;
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

  it("beperkt hoeveel kandidaat-missies bekeken worden via maxMissionsConsidered", async () => {
    vi.mocked(listMissionsForOwner).mockResolvedValue([]);

    await advanceMissionsForOwner("owner-1", {
      deadlineAt: farFutureDeadline(),
      maxMissionsConsidered: 7,
    });

    expect(listMissionsForOwner).toHaveBeenCalledWith("owner-1", 7);
  });
});
