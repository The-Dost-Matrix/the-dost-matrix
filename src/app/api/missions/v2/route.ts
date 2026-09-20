import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { verifyIdToken } from "@/core/firebase/admin";
import { recordAgentSeen } from "@/core/repositories/agent-presence-repository";
import {
  AGENT_KEY_HEADER,
  isActionAllowedForAgent,
  resolveAgentOwnerId,
  type RequestActor,
} from "@/core/mission-engine/v2/agent-access";
import {
  countAgentAnswers,
  markAgentAnswer,
  routeOwnerQuestion,
} from "@/core/mission-engine/v2/owner-question-routing";
import type {
  CreateMissionPayload,
} from "@/core/mission-engine/v2/commands";
import { approveAndMergeMissionPullRequest, runDirectorStep } from "@/core/mission-engine/v2/director-runtime";
import { createMissionEngineV2 } from "@/core/mission-engine/v2/engine-factory";
import { listMissionsForOwner } from "@/core/mission-engine/v2/firestore-store";
import type { MissionRiskLevel, MissionV2 } from "@/core/mission-engine/v2/mission";
import { proposeMissionKnowledge } from "@/core/mission-engine/v2/mission-knowledge";
import { getMissionPullRequestStatus } from "@/core/mission-engine/v2/mission-pr-status";
import { executeRoleAssignment } from "@/core/mission-engine/v2/role-runtime";
import { withOwnerLlmSettings } from "@/core/repositories/llm-settings-repository";
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
 * - POST { action: "cancel", ... }   → annuleert een mission (bv. eentje die
 *                                       muurvast zit, zoals een needs-signoff
 *                                       pull request die de eigenaar toch
 *                                       liever handmatig/anders oplost) —
 *                                       gebruikt engine.cancel(), die al
 *                                       bestond maar tot nu toe nergens
 *                                       vandaan aangeroepen kon worden.
 * - POST { action: "approve-and-merge",
 *          missionId }                → roadmap-stap 4: mergt de meest
 *                                       recente pull request van een missie
 *                                       zelf (via approveAndMergeMission-
 *                                       PullRequest in director-runtime.ts),
 *                                       voor het geval de Director eerder
 *                                       een needs-signoff-melding gaf — de
 *                                       eigenaar hoeft hiervoor niet meer
 *                                       naar GitHub.com.
 * - POST { action: "answer-owner-input",
 *          missionId, response,
 *          criterionOutcome? }         → roadmap-stap 12b: beantwoordt het
 *                                       openstaande inputverzoek van een
 *                                       missie (mission.pendingOwnerInput,
 *                                       gezet door de Director via
 *                                       REQUEST_OWNER_INPUT). Ging dat
 *                                       verzoek over een specifiek
 *                                       succescriterium, dan zet
 *                                       criterionOutcome ("PASSED" of
 *                                       "FAILED") dat criterium meteen op
 *                                       GEHAALD/NIET GEHAALD (zie
 *                                       recordOwnerInput in engine.ts) —
 *                                       sluit de tot nu toe dode
 *                                       WAITING_FOR_OWNER-lus.
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

/**
 * Leest een machineleesbaar foutcode-veld van een fout, indien aanwezig
 * (zie DirectorRuntimeError in director-runtime.ts — Stap 5: gestructureerde
 * foutcodes i.p.v. string-matching). De check via een optioneel `code`-veld
 * houdt deze functie ook bruikbaar voor toekomstige, vergelijkbare
 * foutklassen zonder dat de aanroepers hier iets voor moeten aanpassen.
 */
function publicErrorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

/**
 * Roadmapstap 22, onderdeel 1 — twee wegen naar dezelfde ene eigenaar.
 *
 * De browser komt binnen met een Firebase ID-token; een meewerkende
 * Claude-sessie komt binnen met de agentsleutel in een eigen header (zie
 * agent-access.ts voor waarom het een aparte sleutel en een aparte header is).
 * Beide leveren dezelfde eigenaar-UID op en krijgen daarna exact dezelfde
 * behandeling — assertOwnership, de harde escalatieregels en de
 * geautomatiseerde beoordeling staan allemaal ONDER dit punt en merken het
 * verschil niet.
 *
 * De sleutel wordt eerst geprobeerd en faalt stil: ontbreekt hij, is hij
 * verkeerd, of is de omgevingsvariabele niet ingesteld, dan gaat de aanroep
 * gewoon verder langs het Firebase-token. Daarmee verandert er niets voor de
 * browser, ook niet wanneer deze hele koppeling uit staat.
 */
async function requireOwner(
  request: NextRequest,
): Promise<{ ownerId: string; actor: RequestActor }> {
  const agentOwnerId = resolveAgentOwnerId(request.headers.get(AGENT_KEY_HEADER));

  if (agentOwnerId) {
    return { ownerId: agentOwnerId, actor: "agent" };
  }

  const decoded = await verifyIdToken(request.headers.get("authorization"));
  return { ownerId: decoded.uid, actor: "owner" };
}

function assertOwnership(mission: MissionV2, ownerId: string): void {
  if (mission.ownerId !== ownerId) {
    throw new Error("Deze mission hoort niet bij jouw account.");
  }
}

export async function GET(request: NextRequest) {
  let ownerId: string;

  try {
    ({ ownerId } = await requireOwner(request));
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

    // Stap 19: de stand van de pull request en de CI, maar alleen wanneer de
    // UI er expliciet om vraagt. Bewust niet standaard bij elke missie-ophaal:
    // dit kost vier GitHub-aanroepen, en het missiepaneel haalt de missie na
    // elke handeling opnieuw op. Zie mission-pr-status.ts — die geeft null bij
    // elke storing, dus dit kan de route niet laten falen.
    if (request.nextUrl.searchParams.get("pullRequest")) {
      const pullRequest = await getMissionPullRequestStatus(mission);

      return NextResponse.json(
        { mission, pullRequest },
        { headers: { "cache-control": "no-store" } },
      );
    }

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

type CancelBody = {
  action: "cancel";
  missionId?: unknown;
  reason?: unknown;
};

type ApproveAndMergeBody = {
  action: "approve-and-merge";
  missionId?: unknown;
};

type AnswerOwnerInputBody = {
  action: "answer-owner-input";
  missionId?: unknown;
  response?: unknown;
  criterionOutcome?: unknown;
};

type PostBody =
  | CreateBody
  | DispatchBody
  | RunRoleBody
  | AutoStepBody
  | CancelBody
  | ApproveAndMergeBody
  | AnswerOwnerInputBody
  | { action?: unknown };

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

/**
 * Annuleert een mission — gebruikt de al langer bestaande `engine.cancel()`
 * (zie mission-engine/v2/engine.ts en state-machine.ts, die CANCELLED als
 * geldige eindstatus toestaat vanuit vrijwel elke niet-afgeronde status).
 * Tot deze toevoeging was er nergens een aanroeper voor: geen API-actie en
 * geen knop in het dashboard. Nodig geworden nadat een live missie
 * (verzonnen imports die CI lieten falen) muurvast kwam te zitten in een
 * needs-signoff-status waar de eigenaar 'm liever niet via de Director laat
 * oplossen, maar rechtstreeks zelf (of via mij) laat repareren — daarvoor
 * moet de vastzittende mission eerst uit de weg te ruimen zijn.
 */
async function handleCancel(body: CancelBody, ownerId: string) {
  if (typeof body.missionId !== "string" || !body.missionId.trim()) {
    return NextResponse.json({ error: "missionId ontbreekt." }, { status: 400 });
  }

  const engine = createMissionEngineV2();
  const mission = await engine.getMission(body.missionId);

  if (!mission) {
    return NextResponse.json({ error: "Mission niet gevonden." }, { status: 404 });
  }

  assertOwnership(mission, ownerId);

  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "Geannuleerd door de eigenaar vanuit het dashboard.";

  const updated = await engine.cancel({
    actor: { type: "owner", id: ownerId },
    correlationId: randomUUID(),
    issuedAt: new Date().toISOString(),
    commandVersion: "1.0",
    commandId: randomUUID(),
    commandType: "CancelMission",
    targetId: mission.missionId,
    expectedTargetVersion: mission.version,
    payload: { reason },
  });

  // Sluit de Second Brain-leerlus ook voor geannuleerde missies (zie
  // mission-knowledge.ts) — best-effort, kan de annulering zelf nooit
  // alsnog laten mislukken.
  await proposeMissionKnowledge(updated, "cancelled");

  return NextResponse.json({ mission: updated });
}

/**
 * Roadmap-stap 4: mergt de meest recente pull request van een missie
 * rechtstreeks vanuit de app, voor het geval de Director eerder een
 * needs-signoff-foutmelding gaf (zie approveAndMergeMissionPullRequest in
 * director-runtime.ts voor de vangnetten en waarom dit bewust GEEN
 * risicoclassificatie meer uitvoert — een klik hier IS de goedkeuring).
 * Verandert de mission zelf niet (alleen de pull request op GitHub) — de
 * eigenaar klikt daarna gewoon opnieuw op "volgende stap" om de missie
 * daadwerkelijk af te ronden, exact zoals na een handmatige merge op
 * GitHub.com vandaag al werkt.
 */
async function handleApproveAndMerge(body: ApproveAndMergeBody, ownerId: string) {
  if (typeof body.missionId !== "string" || !body.missionId.trim()) {
    return NextResponse.json({ error: "missionId ontbreekt." }, { status: 400 });
  }

  const engine = createMissionEngineV2();
  const mission = await engine.getMission(body.missionId);

  if (!mission) {
    return NextResponse.json({ error: "Mission niet gevonden." }, { status: 404 });
  }

  assertOwnership(mission, ownerId);

  const result = await approveAndMergeMissionPullRequest(mission);

  return NextResponse.json({ mission, ...result });
}

/**
 * Roadmap-stap 12b: beantwoordt het openstaande inputverzoek van een missie
 * (mission.pendingOwnerInput). Dit is het stuk dat tot nu toe ontbrak: de
 * Director kon via REQUEST_OWNER_INPUT al een vraag stellen (mission naar
 * WAITING_FOR_OWNER, zie engine.ts) en engine.recordOwnerInput() bestond al
 * om het antwoord te verwerken, maar geen enkele API-actie riep dat aan —
 * een missie die WAITING_FOR_OWNER werd, liep daardoor altijd dood.
 *
 * Ging het verzoek over een specifiek succescriterium (relatedCriterionId,
 * gezet door de Director bij een QA-oordeel dat "niet vast te stellen" was,
 * of nadat het inhoudelijke herstelplafond was bereikt — zie
 * owner-clarification.ts), dan zet criterionOutcome dat criterium direct op
 * GEHAALD/NIET GEHAALD. Zonder relatedCriterionId (een generiek
 * inputverzoek) heeft criterionOutcome geen effect — de missie hervat dan
 * gewoon, exact het gedrag van vóór deze stap.
 */
async function handleAnswerOwnerInput(
  body: AnswerOwnerInputBody,
  ownerId: string,
  actor: RequestActor,
) {
  if (typeof body.missionId !== "string" || !body.missionId.trim()) {
    return NextResponse.json({ error: "missionId ontbreekt." }, { status: 400 });
  }
  if (typeof body.response !== "string" || !body.response.trim()) {
    return NextResponse.json({ error: "Geef een reden op bij je antwoord." }, { status: 400 });
  }

  const engine = createMissionEngineV2();
  const mission = await engine.getMission(body.missionId);

  if (!mission) {
    return NextResponse.json({ error: "Mission niet gevonden." }, { status: 404 });
  }

  assertOwnership(mission, ownerId);

  if (!mission.pendingOwnerInput) {
    return NextResponse.json(
      { error: "Deze missie heeft geen openstaand inputverzoek om te beantwoorden." },
      { status: 400 },
    );
  }

  const criterionOutcome =
    body.criterionOutcome === "PASSED" || body.criterionOutcome === "FAILED"
      ? body.criterionOutcome
      : null;

  /**
   * Stap 22, onderdeel 2 — hier wordt de routeringsregel afgedwongen.
   *
   * Komt het antwoord van Elroy zelf, dan verandert er niets: hij mag elke
   * vraag beantwoorden, ook de vragen die de agent had mogen doen. Komt het
   * antwoord via de agentsleutel, dan bepaalt routeOwnerQuestion of dat mag,
   * en een "nee" is hier een weigering en geen advies. Zou deze controle
   * alleen aan de kant van de aanroeper staan, dan zou de partij die zich aan
   * de grens moet houden zelf bepalen waar hij ligt.
   */
  let response = body.response.trim();

  if (actor === "agent") {
    const route = routeOwnerQuestion(mission, {
      agentAnswersSoFar: countAgentAnswers(mission),
    });

    if (route?.destination !== "agent") {
      return NextResponse.json(
        {
          error:
            "Deze vraag hoort bij de eigenaar en kan niet namens hem worden beantwoord.",
          reason: route?.reason ?? "Er staat geen vraag open om te beantwoorden.",
        },
        { status: 403 },
      );
    }

    response = markAgentAnswer(response);
  }

  const updated = await engine.recordOwnerInput({
    actor: { type: "owner", id: ownerId },
    correlationId: randomUUID(),
    issuedAt: new Date().toISOString(),
    commandVersion: "1.0",
    commandId: randomUUID(),
    commandType: "RecordOwnerInput",
    targetId: mission.missionId,
    expectedTargetVersion: mission.version,
    payload: {
      requestId: mission.pendingOwnerInput.requestId,
      response,
      criterionOutcome,
    },
  });

  return NextResponse.json({ mission: updated });
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
  let actor: RequestActor;

  try {
    ({ ownerId, actor } = await requireOwner(request));
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

  // Elke handeling die niet uit de browser komt, laat een spoor na in de
  // serverlogboeken. Zou de agentsleutel ooit uitlekken, dan is "wat is hier
  // gebeurd en langs welke weg" een vraag met een antwoord in plaats van
  // giswerk. Het zichtbaar maken hiervan in Command Center is onderdeel 3 van
  // stap 22; dit is de laag eronder, en die hoort er eerder te zijn dan het
  // scherm dat hem toont.
  // F-01 uit de externe review van 20 september 2026: de agentsleutel mag
  // niet bij elke actie. Deze poort staat vóór de switch hieronder, zodat een
  // actie die er later bijkomt standaard gesloten is voor de agent in plaats
  // van standaard open. Zie AGENT_ALLOWED_ACTIONS in agent-access.ts voor
  // waarom approve-and-merge er met opzet buiten valt.
  if (actor === "agent" && !isActionAllowedForAgent(body.action)) {
    console.warn("Agentsleutel geweigerd voor een actie die alleen de eigenaar mag doen", {
      ownerId,
      action: body.action,
      at: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        error:
          "Deze actie kan alleen door de eigenaar zelf worden uitgevoerd, niet met de agentsleutel.",
        reason:
          "Goedkeuren en mergen is de menselijke handtekening onder een wijziging die de geautomatiseerde beoordeling juist niet zelf mag afdoen.",
      },
      { status: 403 },
    );
  }

  if (actor === "agent") {
    console.warn("Mission Engine V2 aangeroepen met de agentsleutel", {
      ownerId,
      action: body.action,
      at: new Date().toISOString(),
    });

    // Het spoor waarop het scherm "Claude kijkt mee" baseert. Bewust
    // afgewacht en niet los weggezet: een aanroep die net binnenkomt hoort al
    // zichtbaar te zijn wanneer het statuspaneel een seconde later ververst.
    // recordAgentSeen faalt nooit naar buiten toe (zie de toelichting daar),
    // dus dit kan de actie zelf niet tegenhouden.
    await recordAgentSeen(ownerId);
  }

  try {
    // Stap 24: één wrapper om alle acties heen in plaats van per handler.
    // Alles wat hierbinnen een LLM-provider opvraagt — de Director, de
    // rollen, de geautomatiseerde signoff, het kennisvoorstel na afloop —
    // gebruikt de providerkeuze van de eigenaar. Eén Firestore-leesactie per
    // verzoek, ongeacht hoeveel modelaanroepen die actie doet.
    return await withOwnerLlmSettings(ownerId, async () => {
      switch (body.action) {
        case "create":
          return await handleCreate(body as CreateBody, ownerId);
        case "dispatch":
          return await handleDispatch(body as DispatchBody, ownerId);
        case "run-role":
          return await handleRunRole(body as RunRoleBody, ownerId);
        case "auto-step":
          return await handleAutoStep(body as AutoStepBody, ownerId);
        case "cancel":
          return await handleCancel(body as CancelBody, ownerId);
        case "approve-and-merge":
          return await handleApproveAndMerge(body as ApproveAndMergeBody, ownerId);
        case "answer-owner-input":
          return await handleAnswerOwnerInput(body as AnswerOwnerInputBody, ownerId, actor);
        default:
          return NextResponse.json({ error: "Onbekende actie." }, { status: 400 });
      }
    });
  } catch (error) {
    console.error("Mission Engine V2 request failed", {
      ownerId,
      action: body.action,
      error: error instanceof Error ? error.message : error,
    });
    const code = publicErrorCode(error);
    return NextResponse.json(
      { error: publicError(error), ...(code ? { code } : {}) },
      { status: 500 },
    );
  }
}
