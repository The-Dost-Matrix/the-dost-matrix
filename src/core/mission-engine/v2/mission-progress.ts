import type { MissionV2 } from "./mission";

/**
 * Leidt de zichtbare fases van een missie af uit wat er DAADWERKELIJK in de
 * missie is vastgelegd — geen vaste stappenbalk die altijd "stap 2 van 5"
 * toont, maar per fase de echte toestand.
 *
 * Bewust beperkt tot de fases waarvoor vandaag ook echt gegevens bestaan:
 * planning, builder, QA, succescriteria en afronden/mergen. De fases
 * "Verificatie" (AWAITING_VERIFICATION, TECHNICAL_REPAIR) en "Review"
 * (SEMANTIC_REPAIR) uit het functioneel ontwerp staan hier NIET tussen: die
 * toestanden bestaan pas na stap 11 en 12 van de roadmap. Ze toevoegen met
 * een placeholder zou precies het probleem herintroduceren dat we in de
 * statuspanelen net hebben weggehaald — een scherm dat iets toont wat er
 * niet is.
 */

export type MissionPhaseState = "WACHT" | "BEZIG" | "KLAAR" | "AANDACHT";

export interface MissionPhase {
  id: "planning" | "builder" | "qa" | "criteria" | "merge";
  label: string;
  state: MissionPhaseState;
  /** Korte, feitelijke toelichting; nooit een aanname. */
  detail: string;
}

function lastAssignmentForRole(mission: MissionV2, roleId: string) {
  const forRole = mission.assignments.filter((assignment) => assignment.roleId === roleId);
  return forRole.length > 0 ? forRole[forRole.length - 1] : null;
}

function buildRolePhase(
  mission: MissionV2,
  roleId: "builder" | "qa",
  id: MissionPhase["id"],
  label: string,
): MissionPhase {
  const assignment = lastAssignmentForRole(mission, roleId);
  const total = mission.assignments.filter((item) => item.roleId === roleId).length;

  if (!assignment) {
    return { id, label, state: "WACHT", detail: "Nog niet ingezet." };
  }

  const suffix = total > 1 ? ` (${total} toewijzingen)` : "";

  switch (assignment.status) {
    case "ACTIVE":
      return { id, label, state: "BEZIG", detail: `Toewijzing loopt${suffix}.` };
    case "COMPLETED":
      return { id, label, state: "KLAAR", detail: `Toewijzing afgerond${suffix}.` };
    case "FAILED":
      return { id, label, state: "AANDACHT", detail: `Laatste toewijzing mislukt${suffix}.` };
    case "WAITING_FOR_INPUT":
      return { id, label, state: "AANDACHT", detail: `Wacht op invoer${suffix}.` };
    case "CANCELLED":
      return { id, label, state: "AANDACHT", detail: `Toewijzing geannuleerd${suffix}.` };
    default:
      return { id, label, state: "WACHT", detail: assignment.status };
  }
}

export function buildPlanningPhase(mission: MissionV2): MissionPhase {
  if (mission.assignments.length > 0) {
    return {
      id: "planning",
      label: "Planning",
      state: "KLAAR",
      detail: `${mission.assignments.length} toewijzing(en) gepland.`,
    };
  }

  if (mission.status === "DRAFT" || mission.status === "READY") {
    return {
      id: "planning",
      label: "Planning",
      state: "WACHT",
      detail: "De Director heeft nog geen stap gezet.",
    };
  }

  return {
    id: "planning",
    label: "Planning",
    state: "BEZIG",
    detail: "De Director bepaalt de eerste stap.",
  };
}

export function buildCriteriaPhase(mission: MissionV2): MissionPhase {
  const total = mission.successCriteria.length;
  const passed = mission.successCriteria.filter((c) => c.status === "PASSED").length;
  const failed = mission.successCriteria.filter((c) => c.status === "FAILED").length;
  // Stap 12b: QA kan een criterium ook niet-vast-te-stellen laten — dat is
  // geen afkeuring, maar vraagt evengoed aandacht (meestal een openstaande
  // vraag aan de eigenaar, zie owner-clarification.ts), dus telt hier mee.
  const undetermined = mission.successCriteria.filter((c) => c.status === "UNDETERMINED").length;

  if (total === 0) {
    return {
      id: "criteria",
      label: "Succescriteria",
      state: "WACHT",
      detail: "Geen succescriteria vastgelegd.",
    };
  }

  if (failed > 0 || undetermined > 0) {
    const parts = [`${passed} van ${total} gehaald`];
    if (failed > 0) parts.push(`${failed} afgekeurd`);
    if (undetermined > 0) parts.push(`${undetermined} niet vast te stellen`);

    return {
      id: "criteria",
      label: "Succescriteria",
      state: "AANDACHT",
      detail: `${parts.join(", ")}.`,
    };
  }

  return {
    id: "criteria",
    label: "Succescriteria",
    state: passed === total ? "KLAAR" : passed > 0 ? "BEZIG" : "WACHT",
    detail: `${passed} van ${total} gehaald.`,
  };
}

/**
 * "Voltooid" betekent in dit project altijd: de pull request is daadwerkelijk
 * gemerged (zie de architectuurprincipes). Daarom mag COMPLETED hier zonder
 * voorbehoud als gemerged worden getoond.
 */
export function buildMergePhase(mission: MissionV2): MissionPhase {
  switch (mission.status) {
    case "COMPLETED":
      return {
        id: "merge",
        label: "Afronden & mergen",
        state: "KLAAR",
        detail: "Pull request gemerged, missie voltooid.",
      };
    case "WAITING_FOR_APPROVAL":
      return {
        id: "merge",
        label: "Afronden & mergen",
        state: "AANDACHT",
        detail: "Wacht op jouw goedkeuring.",
      };
    case "WAITING_FOR_OWNER":
      // Stap 12b: de Director stelde een vraag (zie
      // mission.pendingOwnerInput) in plaats van te stoppen — dit vraagt
      // net zo veel aandacht als een openstaande goedkeuring hierboven.
      return {
        id: "merge",
        label: "Afronden & mergen",
        state: "AANDACHT",
        detail: "Wacht op jouw antwoord op een vraag van de Director.",
      };
    case "CANCELLED":
      return {
        id: "merge",
        label: "Afronden & mergen",
        state: "AANDACHT",
        detail: "Missie geannuleerd.",
      };
    case "FAILED":
      return {
        id: "merge",
        label: "Afronden & mergen",
        state: "AANDACHT",
        detail: "Missie mislukt.",
      };
    default:
      return {
        id: "merge",
        label: "Afronden & mergen",
        state: "WACHT",
        detail: "Nog niet aan de beurt.",
      };
  }
}

export function deriveMissionPhases(mission: MissionV2): MissionPhase[] {
  return [
    buildPlanningPhase(mission),
    buildRolePhase(mission, "builder", "builder", "Builder"),
    buildRolePhase(mission, "qa", "qa", "QA"),
    buildCriteriaPhase(mission),
    buildMergePhase(mission),
  ];
}
