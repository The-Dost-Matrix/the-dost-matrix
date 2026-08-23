import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { verifyIdToken } from "@/core/firebase/admin";
import type {
  CreateMissionPayload,
} from "@/core/mission-engine/v2/commands";
import { runDirectorStep } from "@/core/mission-engine/v2/director-runtime";
import { createMissionEngineV2 } from "@/core/mission-engine/v2/engine-factory";
import { listMissionsForOwner } from "@/core/mission-engine/v2/firestore-store";
import type { MissionRiskLevel, MissionV2 } from "@/core/mission-engine/v2/mission";
import { executeRoleAssignment } from "@/core/mission-engine/v2/role-runtime";
import type { DirectorDecision, JsonValue } from "@/core/contracts/v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * API voor Mission Engine V2 — de eerste écht functionele versie van de
 * Mission Engine, met persistente opslag in Firestore (zie
 * FirestoreMissionEngineStore) en een eerste Role Runtime die daadwerkelijk
 * een LLM aanroept om een toewijzing uit te voeren.
 *
 * Eén route-bestand met een `action`-veld in de POST-body (in plaats van
 * losse dynamische routes per actie) om het aantal bestanden en de kans op
 * fouten in Next.js route-parameters klein te houden.
 *
 * - GET  ?missionId=...              → huidige staat van een mission
 * - POST { action: "create", ... }   → maakt een mission aan en zet hem
 *                                       direct door naar ACTIVE
 * - POST { action: "dispatch", ... } → wijst de mission (handmatig, er is
 *                                       nog geen autonome Director) toe aan
 *                                       de "builder"-rol
 * - POST { action: "run-role", ... } → voert de actieve toewijzing echt uit
 *                                       via de LLM-provider
 * - POST { action: "auto-step", ... } → laat de Director zelf beslissen wat
 *                                       de volgende stap is, en voert die
 *                                       (bij DISPATCH_ROLE) meteen ook uit —
 *                                       dit is de "zelfstandige Director"-knop
 *
 * Alle acties zijn ownerId-scoped: een mission kan alleen worden bekeken of
 * bewerkt door de ingelogde gebruiker die hem heeft aangemaakt.
 */

function publicError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Er is iets misgegaan.";
}

async function requireOwnerId(request: NextRequest): Promise<string> {
  const decoded = await verifyIdToken(request.headers.get("authorization"));
  return decoded.uid;
}

function assertOwnership(mission: MissionV2, ownerId: string): void {
  if (mission.ownerId !== ownerId) {
    throw new Error("Deze mission hoort niet bij jouw account.");
  }
}

export async function GET(request: NextRequest) {
  let ownerId: string;

  try {
    ownerId = await requireOwnerId(request);
  } catch {
    return NextResponse.json(
      { error: "Je sessie is ongeldig of verlopen. Log opnieuw in." },
      { status: 401 },
    );
  }

  const missionId = request.nextUrl.searchParams.get("missionId");
  const listParam = request.nextUrl.searchParams.get("list");

  if (listParam) {
    const parsedLimit = Number(request.nextUrl.searchParams.get("limit"));
    const limit =
      Number.isInteger(parsedLimit) && parsedLimit > 0 && parsedLimit <= 20 ? parsedLimit : 5;

    try {
      const missions = await listMissionsForOwner(ownerId, limit);
      return NextResponse.json({ missions }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: publicError(error) }, { status: 400 });
    }
  }

  if (!missionId) {
    return NextResponse.json(
      { error: "Query-parameter 'missionId' ontbreekt." },
      { status: 400 },
    );
  }

  try {
    const engine = createMissionEngineV2();
    const mission = await engine.getMission(missionId);

    if (!mission) {
      return NextResponse.json({ error: "Mission niet gevonden." }, { status: 404 });
    }

    assertOwnership(mission, ownerId);

    return NextResponse.json({ mission }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 400 });
  }
}

type CreateBody = {
  action: "create";
  title?: unknown;
  objective?: unknown;
  successCriteria?: unknown;
  goalRefs?: unknown;
  priority?: unknown;
  riskLevel?: unknown;
  budget?: unknown;
  constraints?: unknown;
};

type DispatchBody = {
  action: "dispatch";
  missionId?: unknown;
  objective?: unknown;
  successCriteria?: unknown;
};

type RunRoleBody = {
  action: "run-role";
  missionId?: unknown;
  assignmentId?: unknown;
};

type AutoStepBody = {
  action: "auto-step";
  missionId?: unknown;
};

type PostBody = CreateBody | DispatchBody | RunRoleBody | AutoStepBody | { action?: unknown };

const ALLOWED_RISK_LEVELS: MissionRiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

async function handleCreate(body: CreateBody, ownerId: string) {
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "Titel ontbreekt." }, { status: 400 });
  }
  if (typeof body.objective !== "string" || !body.objective.trim()) {
    return NextResponse.json({ error: "Doel (objective) ontbreekt." }, { status: 400 });
  }
  if (
    !Array.isArray(body.successCriteria) ||
    body.successCriteria.length === 0 ||
    !body.successCriteria.every((entry) => typeof entry === "string" && entry.trim())
  ) {
    return NextResponse.json(
      { error: "Minimaal één succescriterium is verplicht." },
      { status: 400 },
    );
  }

  const goalRefs =
    Array.isArray(body.goalRefs) && body.goalRefs.every((entry) => typeof entry === "string")
      ? (body.goalRefs as string[])
      : ["general"];

  const riskLevel =
    typeof body.riskLevel === "string" &&
    ALLOWED_RISK_LEVELS.includes(body.riskLevel as MissionRiskLevel)
      ? (body.riskLevel as MissionRiskLevel)
      : "LOW";

  const priority =
    typeof body.priority === "number" && Number.isInteger(body.priority) && body.priority >= 0
      ? body.priority
      : 1;

  const budget =
    body.budget &&
    typeof body.budget === "object" &&
    typeof (body.budget as { maximumCost?: unknown }).maximumCost === "number"
      ? {
          maximumCost: (body.budget as { maximumCost: number }).maximumCost,
          currency:
            typeof (body.budget as { currency?: unknown }).currency === "string"
              ? (body.budget as { currency: string }).currency
              : "EUR",
        }
      : { maximumCost: 50, currency: "EUR" };

  const constraints =
    Array.isArray(body.constraints) && body.constraints.every((entry) => typeof entry === "string")
      ? (body.constraints as string[])
      : [];

  const engine = createMissionEngineV2();
  const missionId = randomUUID();

  const commandBase = {
    actor: { type: "owner" as const, id: ownerId },
    correlationId: randomUUID(),
    issuedAt: new Date().toISOString(),
    commandVersion: "1.0" as const,
  };

  const payload: CreateMissionPayload = {
    ownerId,
    projectId: "default",
    goalRefs,
    title: body.title.trim(),
    objective: body.objective.trim(),
    priority,
    riskLevel,
    budget,
    successCriteria: (body.successCriteria as string[]).map((entry) => entry.trim()),
    constraints,
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

  return NextResponse.json({ mission }, { status: 201 });
}

async function handleDispatch(body: DispatchBody, ownerId: string) {
  if (typeof body.missionId !== "string" || !body.missionId.trim()) {
    return NextResponse.json({ error: "missionId ontbreekt." }, { status: 400 });
  }

  const engine = createMissionEngineV2();
  const mission = await engine.getMission(body.missionId);

  if (!mission) {
    return NextResponse.json({ error: "Mission niet gevonden." }, { status: 404 });
  }

  assertOwnership(mission, ownerId);

  const successCriteria =
    Array.isArray(body.successCriteria) &&
    body.successCriteria.every((entry) => typeof entry === "string" && entry.trim())
      ? (body.successCriteria as string[])
      : mission.successCriteria.map((criterion) => criterion.description);

  const objective =
    typeof body.objective === "string" && body.objective.trim()
      ? body.objective.trim()
      : mission.objective;

  const decision: DirectorDecision = {
    decisionId: randomUUID(),
    missionId: mission.missionId,
    decisionType: "DISPATCH_ROLE",
    reason: "Handmatig ingezet vanuit de Mission Engine V2-dashboardpagina.",
    nextAction: objective,
    assignedRole: "builder",
    requiredCapabilities: [],
    contextRequirements: [],
    modelConstraints: {},
    approvalRequirement: "none",
    successCriteria,
    failureStrategy: "Bij falen opnieuw plannen (REPLANNING).",
    createdAt: new Date().toISOString(),
  };

  const updated = await engine.applyDirectorDecision({
    actor: { type: "owner", id: ownerId },
    correlationId: randomUUID(),
    issuedAt: new Date().toISOString(),
    commandVersion: "1.0",
    commandId: randomUUID(),
    commandType: "ApplyDirectorDecision",
    targetId: mission.missionId,
    expectedTargetVersion: mission.version,
    payload: { decision: decision as unknown as JsonValue },
  });

  return NextResponse.json({ mission: updated });
}

async function handleRunRole(body: RunRoleBody, ownerId: string) {
  if (typeof body.missionId !== "string" || !body.missionId.trim()) {
    return NextResponse.json({ error: "missionId ontbreekt." }, { status: 400 });
  }

  const engine = createMissionEngineV2();
  const mission = await engine.getMission(body.missionId);

  if (!mission) {
    return NextResponse.json({ error: "Mission niet gevonden." }, { status: 404 });
  }

  assertOwnership(mission, ownerId);

  let assignmentId: string;

  if (typeof body.assignmentId === "string" && body.assignmentId.trim()) {
    assignmentId = body.assignmentId;
  } else if (mission.activeAssignmentIds.length === 1) {
    assignmentId = mission.activeAssignmentIds[0];
  } else if (mission.activeAssignmentIds.length === 0) {
    return NextResponse.json(
      { error: "Deze mission heeft geen actieve toewijzing om uit te voeren." },
      { status: 400 },
    );
  } else {
    return NextResponse.json(
      {
        error:
          "Deze mission heeft meerdere actieve toewijzingen — geef assignmentId expliciet mee.",
      },
      { status: 400 },
    );
  }

  const { mission: updated, roleOutput } = await executeRoleAssignment({
    engine,
    missionId: mission.missionId,
    assignmentId,
    actor: { type: "role", id: "builder" },
  });

  return NextResponse.json({ mission: updated, roleOutput });
}

function resolveActiveAssignmentId(
  mission: MissionV2,
  explicit: unknown,
): { assignmentId: string } | { error: NextResponse } {
  if (typeof explicit === "string" && explicit.trim()) {
    return { assignmentId: explicit };
  }
  if (mission.activeAssignmentIds.length === 1) {
    return { assignmentId: mission.activeAssignmentIds[0] };
  }
  if (mission.activeAssignmentIds.length === 0) {
    return {
      error: NextResponse.json(
        { error: "Deze mission heeft geen actieve toewijzing om uit te voeren." },
        { status: 400 },
      ),
    };
  }
  return {
    error: NextResponse.json(
      {
        error:
          "Deze mission heeft meerdere actieve toewijzingen — geef assignmentId expliciet mee.",
      },
      { status: 400 },
    ),
  };
}

async function handleAutoStep(body: AutoStepBody, ownerId: string) {
  if (typeof body.missionId !== "string" || !body.missionId.trim()) {
    return NextResponse.json({ error: "missionId ontbreekt." }, { status: 400 });
  }

  const engine = createMissionEngineV2();
  let mission = await engine.getMission(body.missionId);

  if (!mission) {
    return NextResponse.json({ error: "Mission niet gevonden." }, { status: 404 });
  }

  assertOwnership(mission, ownerId);

  if (mission.status === "ACTIVE") {
    const { mission: afterDecision, decision, usedKnowledge } = await runDirectorStep({
      engine,
      missionId: mission.missionId,
    });
    mission = afterDecision;

    if (decision.decisionType !== "DISPATCH_ROLE") {
      // COMPLETE_MISSION (of een ander eindresultaat) — niets meer om
      // meteen uit te voeren.
      return NextResponse.json({ mission, decision, usedKnowledge });
    }

    const resolved = resolveActiveAssignmentId(
      mission,
      mission.activeAssignmentIds[mission.activeAssignmentIds.length - 1],
    );
    if ("error" in resolved) return resolved.error;

    const { mission: afterRole, roleOutput } = await executeRoleAssignment({
      engine,
      missionId: mission.missionId,
      assignmentId: resolved.assignmentId,
    });

    return NextResponse.json({ mission: afterRole, decision, roleOutput, usedKnowledge });
  }

  if (mission.status === "WAITING_FOR_ROLE") {
    const resolved = resolveActiveAssignmentId(mission, undefined);
    if ("error" in resolved) return resolved.error;

    const { mission: afterRole, roleOutput } = await executeRoleAssignment({
      engine,
      missionId: mission.missionId,
      assignmentId: resolved.assignmentId,
    });

    return NextResponse.json({ mission: afterRole, roleOutput });
  }

  return NextResponse.json(
    {
      error: `De Director kan hier nu niet automatisch mee verder (status: ${mission.status}).`,
    },
    { status: 400 },
  );
}

export async function POST(request: NextRequest) {
  let ownerId: string;

  try {
    ownerId = await requireOwnerId(request);
  } catch {
    return NextResponse.json(
      { error: "Je sessie is ongeldig of verlopen. Log opnieuw in." },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as PostBody | null;

  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Veld 'action' ontbreekt." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "create":
        return await handleCreate(body as CreateBody, ownerId);
      case "dispatch":
        return await handleDispatch(body as DispatchBody, ownerId);
      case "run-role":
        return await handleRunRole(body as RunRoleBody, ownerId);
      case "auto-step":
        return await handleAutoStep(body as AutoStepBody, ownerId);
      default:
        return NextResponse.json({ error: "Onbekende actie." }, { status: 400 });
    }
  } catch (error) {
    console.error("Mission Engine V2 request failed", {
      ownerId,
      action: body.action,
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}
