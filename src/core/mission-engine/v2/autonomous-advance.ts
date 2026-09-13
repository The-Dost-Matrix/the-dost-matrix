import { runDirectorStep, DirectorRuntimeError } from "./director-runtime";
import { createMissionEngineV2 } from "./engine-factory";
import { listMissionsForOwner } from "./firestore-store";
import type { MissionV2 } from "./mission";
import { executeRoleAssignment } from "./role-runtime";

/**
 * Stap 15 (deel 2) — autonome missie-triggers.
 *
 * Dit bestand bevat de kernlogica achter het onbewaakt (bijvoorbeeld
 * 's nachts) laten doorlopen van missies, zonder dat Elroy zelf op
 * "volgende stap" hoeft te klikken. Het is bewust een losstaande functie
 * (niet in de API-route zelf) zodat de logica los van HTTP/auth-details
 * getest kan worden.
 *
 * Herziening van 12 september 2026 (zie docs/roadmap.md): Elroy heeft
 * expliciet gevraagd om dit te bouwen ("we moeten zorgen dat [...] de
 * autonome missie trigger gaat werken"), gekoppeld aan zijn beslissing om
 * needs-signoff aan mij te delegeren (zie automated-signoff.ts en
 * findHardEscalationReason in risk-classification.ts). Zonder die twee
 * stukken zou een autonome trigger zinloos zijn: elke missie die een
 * pull request moet mergen zou toch vastlopen op een knop die alleen Elroy
 * kan indrukken.
 *
 * Waarom hier GEEN nieuwe Firestore-composiet-index nodig is: deze functie
 * hergebruikt bewust `listMissionsForOwner` (ownerId == , orderBy updatedAt
 * desc) — exact dezelfde query als de bestaande `GET ?list=`-actie in
 * route.ts, die al in productie draait. Een missie die nog ACTIVE of
 * WAITING_FOR_ROLE is, is per definitie een missie waar de Director/een rol
 * kortgeleden iets aan gedaan heeft, dus staat vrijwel altijd al bovenaan
 * "meest recent bijgewerkt". Filteren op status gebeurt daarom in het
 * geheugen (na ophalen), in plaats van via een extra `where("status", "in",
 * [...])`-clausule die een handmatig aan te maken Firestore-index zou
 * vereisen — precies het soort extra installatiestap die 's nachts, zonder
 * dat iemand het kan oplossen, een onbewaakte run zou laten mislukken.
 *
 * Elke stap (een Director-beslissing, of het uitvoeren van een toewijzing)
 * is een aparte LLM-aanroep en dus niet gratis in tijd. Vercel's
 * functie-tijdslimiet (300 seconden op het Hobby-plan) begrenst hoeveel we
 * in één aanroep van deze functie kunnen doen — vandaar de `deadlineAt`-
 * parameter, gecontroleerd vóór elke nieuwe stap, en een aparte
 * `maxStepsPerMission`-veiligheidsgrens per missie (onafhankelijk van de
 * tijd) zodat een enkele haperende missie nooit de hele batch kan opslokken.
 *
 * Bewust GEEN try/catch rond de hele batch, wel rond elke afzonderlijke
 * missie: een DirectorRuntimeError (bijv. NEEDS_SIGNOFF omdat de
 * geautomatiseerde beoordeling zelf escaleerde, of CI_CHECKS_PENDING omdat
 * de CI nog loopt) betekent "deze missie kan nu niet verder", niet "de hele
 * nachtelijke run is mislukt" — de andere missies van Elroy moeten gewoon
 * doorgaan.
 */

const DEFAULT_MAX_MISSIONS = 20;
const DEFAULT_MAX_STEPS_PER_MISSION = 25;

const ADVANCEABLE_STATUSES: MissionV2["status"][] = ["ACTIVE", "WAITING_FOR_ROLE"];

export interface AdvanceMissionsOptions {
  /** Epoch-milliseconden waarna geen nieuwe stap meer gestart mag worden. */
  deadlineAt: number;
  /** Veiligheidsgrens per missie, los van de tijdslimiet. */
  maxStepsPerMission?: number;
  /** Hoeveel kandidaat-missies (meest recent bijgewerkt) bekeken worden. */
  maxMissionsConsidered?: number;
}

export interface MissionAdvanceOutcome {
  missionId: string;
  title: string;
  startStatus: MissionV2["status"];
  endStatus: MissionV2["status"];
  stepsTaken: number;
  /** Waarom deze missie stopte: klaar, een blokkade, of een limiet. */
  stoppedReason:
    | "TERMINAL_OR_WAITING_STATUS"
    | "STEP_LIMIT_REACHED"
    | "DEADLINE_REACHED"
    | "DIRECTOR_ERROR";
  /** Bij DIRECTOR_ERROR: de foutcode/boodschap, voor in de logs. */
  errorCode?: string;
  errorMessage?: string;
}

export interface AdvanceMissionsResult {
  ownerId: string;
  consideredMissions: number;
  outcomes: MissionAdvanceOutcome[];
  deadlineReachedBeforeAllDone: boolean;
  durationMs: number;
}

function resolveActiveAssignmentId(mission: MissionV2): string | null {
  if (mission.activeAssignmentIds.length === 1) {
    return mission.activeAssignmentIds[0];
  }
  if (mission.activeAssignmentIds.length === 0) {
    return null;
  }
  // Meerdere actieve toewijzingen tegelijk komt in de praktijk (nog) niet
  // voor in de autonome flow (zie ook handleAutoStep in route.ts, die in
  // dat geval expliciet om een keuze vraagt) — pak de laatst toegevoegde,
  // net als de "auto-step"-actie in de API vanuit het dashboard doet.
  return mission.activeAssignmentIds[mission.activeAssignmentIds.length - 1];
}

async function advanceSingleMission(
  mission: MissionV2,
  { deadlineAt, maxStepsPerMission }: { deadlineAt: number; maxStepsPerMission: number },
): Promise<MissionAdvanceOutcome> {
  const engine = createMissionEngineV2();
  const startStatus = mission.status;
  let current = mission;
  let steps = 0;

  try {
    while (steps < maxStepsPerMission) {
      if (Date.now() >= deadlineAt) {
        return {
          missionId: mission.missionId,
          title: mission.title,
          startStatus,
          endStatus: current.status,
          stepsTaken: steps,
          stoppedReason: "DEADLINE_REACHED",
        };
      }

      if (current.status === "ACTIVE") {
        const { mission: afterDecision, decision } = await runDirectorStep({
          engine,
          missionId: current.missionId,
        });
        current = afterDecision;

        if (decision.decisionType !== "DISPATCH_ROLE") {
          // COMPLETE_MISSION of een ander eindresultaat — niets meer om nu
          // uit te voeren.
          break;
        }

        const assignmentId = resolveActiveAssignmentId(current);
        if (!assignmentId) break;

        const { mission: afterRole } = await executeRoleAssignment({
          engine,
          missionId: current.missionId,
          assignmentId,
        });
        current = afterRole;
        steps += 1;
        continue;
      }

      if (current.status === "WAITING_FOR_ROLE") {
        const assignmentId = resolveActiveAssignmentId(current);
        if (!assignmentId) break;

        const { mission: afterRole } = await executeRoleAssignment({
          engine,
          missionId: current.missionId,
          assignmentId,
        });
        current = afterRole;
        steps += 1;
        continue;
      }

      // WAITING_FOR_OWNER, WAITING_FOR_APPROVAL, COMPLETED, FAILED,
      // CANCELLED, DRAFT, READY, REPLANNING, PAUSED — geen van deze statussen
      // hoort hier autonoom vanaf verder geholpen te worden (WAITING_FOR_OWNER
      // heeft letterlijk Elroy's antwoord nodig, de rest is al een eindstatus
      // of vereist een expliciete handeling van hem).
      break;
    }

    if (steps >= maxStepsPerMission) {
      return {
        missionId: mission.missionId,
        title: mission.title,
        startStatus,
        endStatus: current.status,
        stepsTaken: steps,
        stoppedReason: "STEP_LIMIT_REACHED",
      };
    }

    return {
      missionId: mission.missionId,
      title: mission.title,
      startStatus,
      endStatus: current.status,
      stepsTaken: steps,
      stoppedReason: "TERMINAL_OR_WAITING_STATUS",
    };
  } catch (error) {
    const code = error instanceof DirectorRuntimeError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);

    return {
      missionId: mission.missionId,
      title: mission.title,
      startStatus,
      endStatus: current.status,
      stepsTaken: steps,
      stoppedReason: "DIRECTOR_ERROR",
      errorCode: code,
      errorMessage: message,
    };
  }
}

/**
 * Laat alle ACTIVE- of WAITING_FOR_ROLE-missies van een eigenaar zo ver
 * mogelijk doorlopen, begrensd door `deadlineAt`. Bedoeld om periodiek
 * (bijv. elke ~10 minuten via GitHub Actions, zie
 * .github/workflows/advance-missions.yml) aangeroepen te worden door de
 * nieuwe `/api/missions/v2/advance`-route — zie dat bestand voor de
 * authenticatie (gedeeld geheim, geen ingelogde gebruiker nodig).
 */
export async function advanceMissionsForOwner(
  ownerId: string,
  options: AdvanceMissionsOptions,
): Promise<AdvanceMissionsResult> {
  const startedAt = Date.now();
  const maxStepsPerMission = options.maxStepsPerMission ?? DEFAULT_MAX_STEPS_PER_MISSION;
  const maxMissionsConsidered = options.maxMissionsConsidered ?? DEFAULT_MAX_MISSIONS;

  const candidates = await listMissionsForOwner(ownerId, maxMissionsConsidered);
  const advanceable = candidates.filter((mission) =>
    ADVANCEABLE_STATUSES.includes(mission.status),
  );

  const outcomes: MissionAdvanceOutcome[] = [];
  let deadlineReachedBeforeAllDone = false;

  for (const mission of advanceable) {
    if (Date.now() >= options.deadlineAt) {
      deadlineReachedBeforeAllDone = true;
      outcomes.push({
        missionId: mission.missionId,
        title: mission.title,
        startStatus: mission.status,
        endStatus: mission.status,
        stepsTaken: 0,
        stoppedReason: "DEADLINE_REACHED",
      });
      continue;
    }

    const outcome = await advanceSingleMission(mission, {
      deadlineAt: options.deadlineAt,
      maxStepsPerMission,
    });
    outcomes.push(outcome);

    if (outcome.stoppedReason === "DEADLINE_REACHED") {
      deadlineReachedBeforeAllDone = true;
    }
  }

  return {
    ownerId,
    consideredMissions: advanceable.length,
    outcomes,
    deadlineReachedBeforeAllDone,
    durationMs: Date.now() - startedAt,
  };
}
