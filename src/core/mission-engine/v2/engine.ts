import type {
  ActorRef,
  CommandEnvelope,
  DirectorDecision,
  DomainEventEnvelope,
  EntityId,
  JsonValue,
  RoleResult,
} from "@/core/contracts/v2";
import {
  assertCommandEnvelope,
  assertDirectorDecision,
  assertNonEmptyString,
  assertRoleResult,
} from "@/core/contracts/v2";
import type {
  ApplyDirectorDecisionPayload,
  CreateMissionPayload,
  EvaluateCriterionPayload,
  ReasonPayload,
  RecordApprovalPayload,
  RecordOwnerInputPayload,
  RecordRoleResultPayload,
} from "./commands";
import type { MissionEventPayload, MissionEventType } from "./events";
import {
  assertMission,
  hasPassedAllCriteria,
  type MissionAssignmentRecord,
  type MissionStatus,
  type MissionV2,
} from "./mission";
import { assertMissionTransition } from "./state-machine";
import type { MissionEngineStore } from "./store";
import { DuplicateCommandError, MissionNotFoundError } from "./store";

export interface MissionClock {
  now(): string;
}

export interface MissionIdFactory {
  nextId(prefix: string): EntityId;
}

export class MissionEngine {
  constructor(
    private readonly store: MissionEngineStore,
    private readonly clock: MissionClock,
    private readonly ids: MissionIdFactory,
  ) {}

  /**
   * Alleen-lezen opvraging van de huidige staat van een mission.
   * Muteert niets en telt niet mee voor command-idempotentie — bedoeld
   * voor callers (bv. API-routes of een Role Runtime) die eerst de actuele
   * staat nodig hebben (zoals de huidige `version`) voordat ze een command
   * samenstellen.
   */
  async getMission(missionId: EntityId): Promise<MissionV2 | null> {
    const mission = await this.store.findMission(missionId);
    return mission ? structuredClone(mission) : null;
  }

  async create(command: CommandEnvelope<CreateMissionPayload>): Promise<MissionV2> {
    this.assertCommand(command, "CreateMission");
    await this.assertNotProcessed(command.commandId);
    const now = this.clock.now();
    const mission: MissionV2 = {
      missionId: command.targetId,
      ownerId: command.payload.ownerId,
      projectId: command.payload.projectId,
      goalRefs: [...command.payload.goalRefs],
      title: command.payload.title,
      objective: command.payload.objective,
      status: "DRAFT",
      priority: command.payload.priority,
      riskLevel: command.payload.riskLevel,
      budget: { ...command.payload.budget },
      spentCost: 0,
      successCriteria: command.payload.successCriteria.map((description, index) => ({
        criterionId: `${command.targetId}:criterion:${index + 1}`,
        description,
        status: "PENDING",
        evidenceRefs: [],
      })),
      constraints: [...command.payload.constraints],
      assignments: [],
      activeAssignmentIds: [],
      ownerApprovalState: "NOT_REQUIRED",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    assertMission(mission);
    await this.store.commitCreate(command.commandId, {
      mission,
      event: this.event(command, mission, "mission.created", null),
    });
    return structuredClone(mission);
  }

  async markReady(command: CommandEnvelope<Record<string, never>>): Promise<MissionV2> {
    return this.transition(command, "MarkMissionReady", "READY", "mission.ready");
  }

  async activate(command: CommandEnvelope<Record<string, never>>): Promise<MissionV2> {
    return this.transition(command, "ActivateMission", "ACTIVE", "mission.activated");
  }

  async applyDirectorDecision(
    command: CommandEnvelope<ApplyDirectorDecisionPayload>,
  ): Promise<MissionV2> {
    this.assertCommand(command, "ApplyDirectorDecision");
    const decision = command.payload.decision as unknown as DirectorDecision;
    assertDirectorDecision(decision);
    const mission = await this.loadForUpdate(command);
    if (decision.missionId !== mission.missionId) {
      throw new Error("Director-besluit hoort bij een andere mission.");
    }
    if (["DRAFT", "READY", "PAUSED", "COMPLETED", "FAILED", "CANCELLED"].includes(mission.status)) {
      throw new Error(`Director-besluit is niet toegestaan vanuit ${mission.status}.`);
    }

    const previousStatus = mission.status;
    mission.currentDecisionId = decision.decisionId;
    let eventType: MissionEventType = "mission.decision_recorded";
    let details: Partial<MissionEventPayload> = { decisionId: decision.decisionId };

    switch (decision.decisionType) {
      case "DISPATCH_ROLE": {
        const assignmentId = this.ids.nextId("assignment");
        const now = this.clock.now();
        const assignment: MissionAssignmentRecord = {
          assignmentId,
          decisionId: decision.decisionId,
          roleId: decision.assignedRole!,
          status: "ACTIVE",
          objective: decision.nextAction,
          successCriteria: [...decision.successCriteria],
          createdAt: now,
          updatedAt: now,
        };
        mission.assignments.push(assignment);
        mission.activeAssignmentIds.push(assignmentId);
        this.changeStatus(mission, "WAITING_FOR_ROLE");
        eventType = "mission.role_dispatched";
        details = { ...details, assignmentId };
        break;
      }
      case "REQUEST_OWNER_INPUT": {
        const requestId = this.ids.nextId("input");
        mission.pendingOwnerInput = {
          requestId,
          question: decision.nextAction,
          requestedAt: this.clock.now(),
        };
        this.changeStatus(mission, "WAITING_FOR_OWNER");
        eventType = "mission.owner_input_requested";
        details = { ...details, requestId };
        break;
      }
      case "REQUEST_APPROVAL": {
        const approvalId = this.ids.nextId("approval");
        mission.pendingApproval = {
          approvalId,
          action: decision.nextAction,
          reason: decision.reason,
          requestedAt: this.clock.now(),
        };
        mission.ownerApprovalState = "PENDING";
        this.changeStatus(mission, "WAITING_FOR_APPROVAL");
        eventType = "mission.approval_requested";
        details = { ...details, approvalId };
        break;
      }
      case "REPLAN":
        this.changeStatus(mission, "REPLANNING");
        eventType = "mission.replanning_requested";
        break;
      case "PAUSE_MISSION":
        this.changeStatus(mission, "PAUSED");
        eventType = "mission.paused";
        break;
      case "COMPLETE_MISSION":
        this.assertCompletable(mission);
        this.changeStatus(mission, "COMPLETED");
        mission.completedAt = this.clock.now();
        eventType = "mission.completed";
        break;
      case "CANCEL_MISSION":
        this.changeStatus(mission, "CANCELLED");
        mission.cancellationReason = decision.reason;
        eventType = "mission.cancelled";
        break;
      case "STORE_KNOWLEDGE":
      case "EVALUATE_RESULT":
        break;
    }

    return this.commit(command, mission, previousStatus, eventType, details);
  }

  async recordRoleResult(
    command: CommandEnvelope<RecordRoleResultPayload>,
  ): Promise<MissionV2> {
    this.assertCommand(command, "RecordRoleResult");
    const result = command.payload.result as unknown as RoleResult;
    assertRoleResult(result);
    const mission = await this.loadForUpdate(command);
    if (result.missionId !== mission.missionId) {
      throw new Error("Rolresultaat hoort bij een andere mission.");
    }
    const assignment = mission.assignments.find(
      (candidate) => candidate.assignmentId === result.assignmentId,
    );
    if (!assignment || assignment.status !== "ACTIVE") {
      throw new Error(`Assignment ${result.assignmentId} is niet actief.`);
    }

    const previousStatus = mission.status;
    assignment.resultId = result.resultId;
    assignment.updatedAt = this.clock.now();
    assignment.status = result.status;
    mission.activeAssignmentIds = mission.activeAssignmentIds.filter(
      (id) => id !== result.assignmentId,
    );
    mission.spentCost += result.usage.cost ?? 0;

    switch (result.status) {
      case "COMPLETED":
        this.changeStatus(mission, "ACTIVE");
        break;
      case "FAILED":
      case "CANCELLED":
        this.changeStatus(mission, "REPLANNING");
        break;
      case "WAITING_FOR_INPUT": {
        const requestId = this.ids.nextId("input");
        mission.pendingOwnerInput = {
          requestId,
          question: result.uncertainties[0] ?? result.summary,
          requestedAt: this.clock.now(),
        };
        this.changeStatus(mission, "WAITING_FOR_OWNER");
        break;
      }
    }

    return this.commit(command, mission, previousStatus, "mission.role_result_recorded", {
      assignmentId: result.assignmentId,
      resultId: result.resultId,
    });
  }

  async recordOwnerInput(
    command: CommandEnvelope<RecordOwnerInputPayload>,
  ): Promise<MissionV2> {
    this.assertCommand(command, "RecordOwnerInput");
    assertNonEmptyString(command.payload.response, "response");
    const mission = await this.loadForUpdate(command);
    if (!mission.pendingOwnerInput || mission.pendingOwnerInput.requestId !== command.payload.requestId) {
      throw new Error("Geen passend open inputverzoek gevonden.");
    }
    const previousStatus = mission.status;
    const requestId = mission.pendingOwnerInput.requestId;
    delete mission.pendingOwnerInput;
    this.changeStatus(mission, "ACTIVE");
    return this.commit(command, mission, previousStatus, "mission.owner_input_recorded", {
      requestId,
    });
  }

  async recordApproval(
    command: CommandEnvelope<RecordApprovalPayload>,
  ): Promise<MissionV2> {
    this.assertCommand(command, "RecordApproval");
    const mission = await this.loadForUpdate(command);
    if (!mission.pendingApproval || mission.pendingApproval.approvalId !== command.payload.approvalId) {
      throw new Error("Geen passend open goedkeuringsverzoek gevonden.");
    }
    const previousStatus = mission.status;
    const approvalId = mission.pendingApproval.approvalId;
    delete mission.pendingApproval;
    mission.ownerApprovalState = command.payload.approved ? "APPROVED" : "REJECTED";
    this.changeStatus(mission, command.payload.approved ? "ACTIVE" : "REPLANNING");
    return this.commit(command, mission, previousStatus, "mission.approval_recorded", {
      approvalId,
      reason: command.payload.reason ?? undefined,
    });
  }

  async evaluateCriterion(
    command: CommandEnvelope<EvaluateCriterionPayload>,
  ): Promise<MissionV2> {
    this.assertCommand(command, "EvaluateMissionCriterion");
    const mission = await this.loadForUpdate(command);
    const criterion = mission.successCriteria.find(
      (candidate) => candidate.criterionId === command.payload.criterionId,
    );
    if (!criterion) {
      throw new Error(`Onbekend succescriterium: ${command.payload.criterionId}`);
    }
    const previousStatus = mission.status;
    criterion.status = command.payload.passed ? "PASSED" : "FAILED";
    criterion.evidenceRefs = [...command.payload.evidenceRefs];
    criterion.evaluatedAt = this.clock.now();
    return this.commit(command, mission, previousStatus, "mission.criterion_evaluated", {
      criterionId: criterion.criterionId,
    });
  }

  async pause(command: CommandEnvelope<ReasonPayload>): Promise<MissionV2> {
    assertNonEmptyString(command.payload.reason, "reason");
    return this.transition(command, "PauseMission", "PAUSED", "mission.paused", {
      reason: command.payload.reason ?? undefined,
    });
  }

  async resume(command: CommandEnvelope<Record<string, never>>): Promise<MissionV2> {
    this.assertCommand(command, "ResumeMission");
    const mission = await this.loadForUpdate(command);
    const previousStatus = mission.status;
    const target: MissionStatus = mission.currentDecisionId ? "REPLANNING" : "READY";
    this.changeStatus(mission, target);
    return this.commit(command, mission, previousStatus, "mission.resumed");
  }

  async fail(command: CommandEnvelope<ReasonPayload>): Promise<MissionV2> {
    assertNonEmptyString(command.payload.reason, "reason");
    const mission = await this.loadForUpdateWithType(command, "FailMission");
    const previousStatus = mission.status;
    this.changeStatus(mission, "FAILED");
    mission.failureReason = command.payload.reason;
    return this.commit(command, mission, previousStatus, "mission.failed", {
      reason: command.payload.reason ?? undefined,
    });
  }

  async cancel(command: CommandEnvelope<ReasonPayload>): Promise<MissionV2> {
    assertNonEmptyString(command.payload.reason, "reason");
    const mission = await this.loadForUpdateWithType(command, "CancelMission");
    const previousStatus = mission.status;
    this.changeStatus(mission, "CANCELLED");
    mission.cancellationReason = command.payload.reason;
    return this.commit(command, mission, previousStatus, "mission.cancelled", {
      reason: command.payload.reason ?? undefined,
    });
  }

  private async transition<TPayload extends JsonValue>(
    command: CommandEnvelope<TPayload>,
    commandType: string,
    targetStatus: MissionStatus,
    eventType: MissionEventType,
    details: Partial<MissionEventPayload> = {},
  ): Promise<MissionV2> {
    this.assertCommand(command, commandType);
    const mission = await this.loadForUpdate(command);
    const previousStatus = mission.status;
    this.changeStatus(mission, targetStatus);
    return this.commit(command, mission, previousStatus, eventType, details);
  }

  private async loadForUpdate<TPayload extends JsonValue>(
    command: CommandEnvelope<TPayload>,
  ): Promise<MissionV2> {
    await this.assertNotProcessed(command.commandId);
    const mission = await this.store.findMission(command.targetId);
    if (!mission) {
      throw new MissionNotFoundError(`Mission ${command.targetId} bestaat niet.`);
    }
    if (mission.version !== command.expectedTargetVersion) {
      throw new Error(
        `Versieconflict: verwacht ${command.expectedTargetVersion}, gevonden ${mission.version}.`,
      );
    }
    return mission;
  }

  private async loadForUpdateWithType<TPayload extends JsonValue>(
    command: CommandEnvelope<TPayload>,
    commandType: string,
  ): Promise<MissionV2> {
    this.assertCommand(command, commandType);
    return this.loadForUpdate(command);
  }

  private async commit<TPayload extends JsonValue>(
    command: CommandEnvelope<TPayload>,
    mission: MissionV2,
    previousStatus: MissionStatus,
    eventType: MissionEventType,
    details: Partial<MissionEventPayload> = {},
  ): Promise<MissionV2> {
    const expectedVersion = mission.version;
    mission.version += 1;
    mission.updatedAt = this.clock.now();
    assertMission(mission);
    await this.store.commitUpdate(command.commandId, expectedVersion, {
      mission,
      event: this.event(command, mission, eventType, previousStatus, details),
    });
    return structuredClone(mission);
  }

  private changeStatus(mission: MissionV2, targetStatus: MissionStatus): void {
    assertMissionTransition(mission.status, targetStatus);
    mission.status = targetStatus;
  }

  private assertCompletable(mission: MissionV2): void {
    if (mission.activeAssignmentIds.length > 0) {
      throw new Error("Mission heeft nog actieve assignments.");
    }
    if (mission.pendingOwnerInput || mission.pendingApproval) {
      throw new Error("Mission heeft nog open owner-acties.");
    }
    if (mission.ownerApprovalState === "PENDING" || mission.ownerApprovalState === "REJECTED") {
      throw new Error("Mission heeft geen geldige owner approval.");
    }
    if (!hasPassedAllCriteria(mission)) {
      throw new Error("Niet alle succescriteria zijn behaald.");
    }
  }

  private event<TPayload extends JsonValue>(
    command: CommandEnvelope<TPayload>,
    mission: MissionV2,
    eventType: MissionEventType,
    previousStatus: MissionStatus | null,
    details: Partial<MissionEventPayload> = {},
  ): DomainEventEnvelope<MissionEventPayload> {
    const now = this.clock.now();
    return {
      eventId: this.ids.nextId("event"),
      eventType,
      eventVersion: "1.0",
      aggregateType: "mission",
      aggregateId: mission.missionId,
      aggregateVersion: mission.version,
      correlationId: command.correlationId,
      causationId: command.commandId,
      actor: command.actor as ActorRef,
      occurredAt: now,
      recordedAt: now,
      payload: {
        missionId: mission.missionId,
        previousStatus,
        status: mission.status,
        ...details,
      },
      metadata: {},
    };
  }

  private assertCommand<TPayload extends JsonValue>(
    command: CommandEnvelope<TPayload>,
    expectedType: string,
  ): void {
    assertCommandEnvelope(command);
    if (command.commandType !== expectedType) {
      throw new Error(`Verwacht commandType ${expectedType}, ontvangen ${command.commandType}.`);
    }
  }

  private async assertNotProcessed(commandId: EntityId): Promise<void> {
    if (await this.store.hasProcessedCommand(commandId)) {
      throw new DuplicateCommandError(`Command ${commandId} is al verwerkt.`);
    }
  }
}
