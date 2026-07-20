import type { CommandEnvelope, DomainEventEnvelope, JsonValue } from "@/core/contracts/v2";
import { InMemoryMissionV2Repository } from "./repository";
import { MissionEngine } from "./engine";
import type { MissionEventPayload } from "./events";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export async function verifyMissionEngine(): Promise<void> {
  const events: DomainEventEnvelope<MissionEventPayload>[] = [];
  const repository = new InMemoryMissionV2Repository();
  const engine = new MissionEngine(
    repository,
    { publish: async (event) => { events.push(event); } },
    { now: () => "2026-07-20T19:00:00.000Z" },
    { nextId: (prefix) => `${prefix}_test` },
  );

  const base = {
    actor: { type: "owner", id: "owner_1" } as const,
    correlationId: "corr_1",
    issuedAt: "2026-07-20T19:00:00.000Z",
    commandVersion: "1.0" as const,
  };

  const created = await engine.create({
    ...base,
    commandId: "cmd_create",
    commandType: "CreateMission",
    targetId: "mission_1",
    expectedTargetVersion: 1,
    payload: {
      ownerId: "owner_1",
      projectId: "project_1",
      goalRefs: ["goal_1"],
      title: "Mission Engine bouwen",
      objective: "Een gecontroleerde mission runtime opleveren",
      priority: 1,
      riskLevel: "LOW",
      budget: { maximumCost: 100, currency: "EUR" },
      successCriteria: ["Typecheck slaagt"],
      constraints: [],
    },
  });

  expect(created.status === "DRAFT", "Nieuwe mission moet DRAFT zijn.");
  expect(created.version === 1, "Nieuwe mission moet versie 1 hebben.");

  const readyCommand: CommandEnvelope<JsonValue> = {
    ...base,
    commandId: "cmd_ready",
    commandType: "ActivateMissionForPlanning",
    targetId: created.missionId,
    expectedTargetVersion: 1,
    payload: {},
  };
  const ready = await engine.markReady(readyCommand);
  expect(ready.status === "READY", "Mission moet READY worden.");

  const active = await engine.activate({ ...readyCommand, commandId: "cmd_active", commandType: "ActivateMission", expectedTargetVersion: 2 });
  expect(active.status === "ACTIVE", "Mission moet ACTIVE worden.");
  expect(events.length === 3, "Iedere mutatie moet één event publiceren.");
}
