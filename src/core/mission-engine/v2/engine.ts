import type { ActorRef, CommandEnvelope, DirectorDecision, DomainEventEnvelope, EntityId, IsoDateTime, JsonValue, RoleResult } from "@/core/contracts/v2";
import { assertCommandEnvelope, assertDirectorDecision, assertRoleResult } from "@/core/contracts/v2";
import type { CreateMissionPayload } from "./commands";
import type { MissionEventPayload, MissionEventType } from "./events";
import type { MissionV2, MissionStatus } from "./mission";
import { assertMission } from "./mission";
import type { MissionV2Repository } from "./repository";
import { MissionNotFoundError } from "./repository";
import { assertMissionTransition } from "./state-machine";

export interface MissionEngineClock { now(): IsoDateTime; }
export interface MissionEngineIds { nextId(prefix: string): EntityId; }
export interface MissionEventPublisher { publish(event: DomainEventEnvelope<MissionEventPayload>): Promise<void>; }

export class SystemClock implements MissionEngineClock { now(): IsoDateTime { return new Date().toISOString(); } }
export class RandomMissionIds implements MissionEngineIds { nextId(prefix: string): EntityId { return `${prefix}_${crypto.randomUUID()}`; } }

export class MissionEngine {
  constructor(
    private readonly repository: MissionV2Repository,
    private readonly publisher: MissionEventPublisher,
    private readonly clock: MissionEngineClock = new SystemClock(),
    private readonly ids: MissionEngineIds = new RandomMissionIds(),
  ) {}

  async create(command: CommandEnvelope<CreateMissionPayload & JsonValue>): Promise<MissionV2> {
    assertCommandEnvelope(command);
    const now = this.clock.now();
    const payload = command.payload;
    const mission: MissionV2 = {
      missionId: command.targetId,
      ownerId: payload.ownerId,
      projectId: payload.projectId,
      goalRefs: payload.goalRefs,
      title: payload.title,
      objective: payload.objective,
      status: "DRAFT",
      priority: payload.priority,
      riskLevel: payload.riskLevel,
      budget: payload.budget,
      spentCost: 0,
      successCriteria: payload.successCriteria,
      constraints: payload.constraints,
      activeAssignmentIds: [],
      ownerApprovalState: "NOT_REQUIRED",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    assertMission(mission);
    await this.repository.create(mission);
    await this.publish(command, mission, "mission.created");
    return mission;
  }

  async markReady(command: CommandEnvelope<JsonValue>): Promise<MissionV2> { return this.transition(command, "READY", "mission.ready"); }
  async activate(command: CommandEnvelope<JsonValue>): Promise<MissionV2> { return this.transition(command, "ACTIVE", "mission.activated"); }
  async pause(command: CommandEnvelope<JsonValue>): Promise<MissionV2> { return this.transition(command, "PAUSED", "mission.state_changed"); }
  async resume(command: CommandEnvelope<JsonValue>): Promise<MissionV2> { return this.transition(command, "ACTIVE", "mission.state_changed"); }

  async applyDirectorDecision(command: CommandEnvelope<{ decision: DirectorDecision } & JsonValue>): Promise<MissionV2> {
    assertCommandEnvelope(command);
    assertDirectorDecision(command.payload.decision);
    const decision = command.payload.decision;
    const mission = await this.load(command.targetId);
    if (decision.missionId !== mission.missionId) throw new Error("Director-besluit hoort bij een andere mission.");

    const target = this.statusForDecision(decision);
    const updated = this.withTransition(mission, target, command.expectedTargetVersion);
    updated.currentDecisionId = decision.decisionId;
    if (decision.decisionType === "REQUEST_APPROVAL") updated.ownerApprovalState = "PENDING";
    await this.repository.save(updated, command.expectedTargetVersion);
    await this.publish(command, updated, this.eventForDecision(decision), mission.status);
    return updated;
  }

  async recordRoleResult(command: CommandEnvelope<{ result: RoleResult } & JsonValue>): Promise<MissionV2> {
    assertCommandEnvelope(command);
    assertRoleResult(command.payload.result);
    const mission = await this.load(command.targetId);
    const result = command.payload.result;
    if (result.missionId !== mission.missionId) throw new Error("Rolresultaat hoort bij een andere mission.");
    const updated = this.withTransition(mission, result.status === "FAILED" ? "REPLANNING" : "ACTIVE", command.expectedTargetVersion);
    updated.activeAssignmentIds = updated.activeAssignmentIds.filter((id) => id !== result.assignmentId);
    if (result.usage.cost) updated.spentCost += result.usage.cost;
    assertMission(updated);
    await this.repository.save(updated, command.expectedTargetVersion);
    await this.publish(command, updated, "mission.state_changed", mission.status);
    return updated;
  }

  async complete(command: CommandEnvelope<JsonValue>): Promise<MissionV2> {
    const mission = await this.load(command.targetId);
    if (mission.activeAssignmentIds.length > 0) throw new Error("Mission heeft nog actieve roltoewijzingen.");
    if (mission.ownerApprovalState === "PENDING" || mission.ownerApprovalState === "REJECTED") throw new Error("Mission kan niet worden voltooid zonder geldige goedkeuring.");
    return this.transition(command, "COMPLETED", "mission.completed", { completedAt: this.clock.now() });
  }

  async fail(command: CommandEnvelope<{ reason: string } & JsonValue>): Promise<MissionV2> {
    return this.transition(command, "FAILED", "mission.failed", { failureReason: command.payload.reason });
  }

  async cancel(command: CommandEnvelope<{ reason: string } & JsonValue>): Promise<MissionV2> {
    return this.transition(command, "CANCELLED", "mission.cancelled", { cancellationReason: command.payload.reason });
  }

  private async transition(command: CommandEnvelope<JsonValue>, status: MissionStatus, eventType: MissionEventType, patch: Partial<MissionV2> = {}): Promise<MissionV2> {
    assertCommandEnvelope(command);
    const mission = await this.load(command.targetId);
    const updated = Object.assign(this.withTransition(mission, status, command.expectedTargetVersion), patch);
    await this.repository.save(updated, command.expectedTargetVersion);
    await this.publish(command, updated, eventType, mission.status);
    return updated;
  }

  private withTransition(mission: MissionV2, status: MissionStatus, expectedVersion: number): MissionV2 {
    if (mission.version !== expectedVersion) throw new Error(`Versieconflict: verwacht ${expectedVersion}, gevonden ${mission.version}.`);
    assertMissionTransition(mission.status, status);
    return { ...mission, status, version: mission.version + 1, updatedAt: this.clock.now() };
  }

  private async load(id: EntityId): Promise<MissionV2> {
    const mission = await this.repository.findById(id);
    if (!mission) throw new MissionNotFoundError(`Mission ${id} bestaat niet.`);
    return mission;
  }

  private statusForDecision(decision: DirectorDecision): MissionStatus {
    switch (decision.decisionType) {
      case "DISPATCH_ROLE": return "WAITING_FOR_ROLE";
      case "REQUEST_OWNER_INPUT": return "WAITING_FOR_OWNER";
      case "REQUEST_APPROVAL": return "WAITING_FOR_APPROVAL";
      case "REPLAN": return "REPLANNING";
      case "PAUSE_MISSION": return "PAUSED";
      case "COMPLETE_MISSION": return "COMPLETED";
      case "CANCEL_MISSION": return "CANCELLED";
      case "STORE_KNOWLEDGE":
      case "EVALUATE_RESULT": return "ACTIVE";
    }
  }

  private eventForDecision(decision: DirectorDecision): MissionEventType {
    switch (decision.decisionType) {
      case "DISPATCH_ROLE": return "mission.role_requested";
      case "REQUEST_OWNER_INPUT": return "mission.owner_input_requested";
      case "REQUEST_APPROVAL": return "mission.approval_requested";
      case "REPLAN": return "mission.replanning_requested";
      case "COMPLETE_MISSION": return "mission.completed";
      case "CANCEL_MISSION": return "mission.cancelled";
      default: return "mission.state_changed";
    }
  }

  private async publish(command: CommandEnvelope<JsonValue>, mission: MissionV2, eventType: MissionEventType, previousStatus?: MissionStatus): Promise<void> {
    const actor: ActorRef = command.actor;
    await this.publisher.publish({
      eventId: this.ids.nextId("evt"),
      eventType,
      eventVersion: "1.0",
      aggregateType: "mission",
      aggregateId: mission.missionId,
      aggregateVersion: mission.version,
      correlationId: command.correlationId,
      causationId: command.commandId,
      actor,
      occurredAt: this.clock.now(),
      recordedAt: this.clock.now(),
      payload: { missionId: mission.missionId, previousStatus: previousStatus ?? null, status: mission.status },
      metadata: {},
    });
  }
}
