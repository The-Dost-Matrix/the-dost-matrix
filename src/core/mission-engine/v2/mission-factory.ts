import { randomUUID } from "node:crypto";

import type { ActorRef } from "@/core/contracts/v2";

import type { CreateMissionPayload } from "./commands";
import { createMissionEngineV2 } from "./engine-factory";
import type { MissionRiskLevel, MissionV2 } from "./mission";

/**
 * Maakt een Mission Engine V2-missie aan en zet hem via dezelfde
 * DRAFT -> READY -> ACTIVE-keten als het handmatige aanmaakformulier op
 * /dashboard/missions-v2 (zie handleCreate in api/missions/v2/route.ts)
 * direct door naar ACTIVE, met verstandige standaardwaarden voor alles wat
 * de aanroeper niet meegeeft.
 *
 * Losgetrokken tot een eigen, herbruikbare functie zodat zowel het
 * aanmaakformulier (via de API-route) als de chat (via chat-service.ts) een
 * missie op precies dezelfde, geteste manier aanmaken — geen tweede,
 * losstaande implementatie van deze commandoketen.
 *
 * Zet de missie bewust NIET meteen aan het werk: er volgt hierna geen
 * automatische Director-stap. De missie staat klaar op ACTIVE, zichtbaar in
 * het Mission Engine V2-paneel; de eigenaar bepaalt zelf wanneer de Director
 * de eerste stap zet.
 */
export interface CreateAndActivateMissionV2Input {
  ownerId: string;
  title: string;
  objective: string;
  successCriteria: string[];
  goalRefs?: string[];
  priority?: number;
  riskLevel?: MissionRiskLevel;
  budget?: { maximumCost: number; currency: string };
  constraints?: string[];
  actor?: ActorRef;
}

export async function createAndActivateMissionV2(
  input: CreateAndActivateMissionV2Input,
): Promise<MissionV2> {
  const engine = createMissionEngineV2();
  const missionId = randomUUID();
  const actor: ActorRef = input.actor ?? { type: "director", id: "director" };

  const commandBase = {
    actor,
    correlationId: randomUUID(),
    issuedAt: new Date().toISOString(),
    commandVersion: "1.0" as const,
  };

  const payload: CreateMissionPayload = {
    ownerId: input.ownerId,
    projectId: "default",
    goalRefs: input.goalRefs?.length ? input.goalRefs : ["general"],
    title: input.title,
    objective: input.objective,
    priority: input.priority ?? 1,
    riskLevel: input.riskLevel ?? "LOW",
    budget: input.budget ?? { maximumCost: 50, currency: "EUR" },
    successCriteria: input.successCriteria,
    constraints: input.constraints ?? [],
  };

  let mission = await engine.create({
    ...commandBase,
    commandId: randomUUID(),
    commandType: "CreateMission",
    targetId: missionId,
    expectedTargetVersion: 1,
    payload,
  });

  mission = await engine.markReady({
    ...commandBase,
    commandId: randomUUID(),
    commandType: "MarkMissionReady",
    targetId: missionId,
    expectedTargetVersion: mission.version,
    payload: {},
  });

  mission = await engine.activate({
    ...commandBase,
    commandId: randomUUID(),
    commandType: "ActivateMission",
    targetId: missionId,
    expectedTargetVersion: mission.version,
    payload: {},
  });

  return mission;
}
