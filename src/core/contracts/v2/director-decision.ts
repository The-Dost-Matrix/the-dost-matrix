import type { EntityId, IsoDateTime, JsonValue } from "./primitives";
import { assertIsoDateTime, assertNonEmptyString, isOneOf } from "./primitives";

export const DIRECTOR_DECISION_TYPES = [
  "DISPATCH_ROLE",
  "REQUEST_OWNER_INPUT",
  "REQUEST_APPROVAL",
  "REPLAN",
  "PAUSE_MISSION",
  "COMPLETE_MISSION",
  "CANCEL_MISSION",
  "STORE_KNOWLEDGE",
  "EVALUATE_RESULT",
] as const;

export type DirectorDecisionType = (typeof DIRECTOR_DECISION_TYPES)[number];

export interface DirectorDecision {
  decisionId: EntityId;
  missionId: EntityId;
  decisionType: DirectorDecisionType;
  reason: string;
  nextAction: string;
  assignedRole?: string;
  /**
   * Wat voor soort toewijzing hieruit moet ontstaan bij DISPATCH_ROLE. Alleen
   * gezet wanneer het geen gewone opdracht is — op dit moment uitsluitend
   * "TECHNICAL_REPAIR", de herstelpoging na een mislukte CI-controle
   * (roadmapstap 11). De engine neemt dit over op de toewijzing zelf; zie
   * AssignmentKind in mission.ts voor waarom dit een veld is en geen
   * afleiding uit de opdrachttekst.
   */
  assignmentKind?: "BUILD" | "TECHNICAL_REPAIR" | "SEMANTIC_REPAIR";
  /**
   * Bij REQUEST_OWNER_INPUT (stap 12b): het succescriterium waar deze vraag
   * over gaat, indien van toepassing. De engine zet dit over op
   * MissionV2.pendingOwnerInput.relatedCriterionId (zie mission.ts), zodat
   * het antwoord van de eigenaar dat ene criterium direct kan bijwerken in
   * plaats van alleen de missie te hervatten (zie recordOwnerInput in
   * engine.ts). Optioneel: een generiek inputverzoek (bijvoorbeeld vanuit
   * een WAITING_FOR_INPUT-rolresultaat) laat dit weg.
   */
  relatedCriterionId?: EntityId;
  requiredCapabilities: string[];
  contextRequirements: string[];
  modelConstraints: Record<string, JsonValue>;
  approvalRequirement: "none" | "owner" | "additional_review";
  successCriteria: string[];
  failureStrategy: string;
  createdAt: IsoDateTime;
}

export function assertDirectorDecision(
  decision: DirectorDecision,
): asserts decision is DirectorDecision {
  assertNonEmptyString(decision.decisionId, "decisionId");
  assertNonEmptyString(decision.missionId, "missionId");

  if (!isOneOf(decision.decisionType, DIRECTOR_DECISION_TYPES)) {
    throw new Error(`Onbekend Director-besluittype: ${decision.decisionType}`);
  }

  assertNonEmptyString(decision.reason, "reason");
  assertNonEmptyString(decision.nextAction, "nextAction");
  assertNonEmptyString(decision.failureStrategy, "failureStrategy");
  assertIsoDateTime(decision.createdAt, "createdAt");

  if (
    decision.decisionType === "DISPATCH_ROLE" &&
    !decision.assignedRole?.trim()
  ) {
    throw new Error("assignedRole is verplicht voor DISPATCH_ROLE.");
  }

  if (decision.successCriteria.length === 0) {
    throw new Error("Een Director-besluit moet minimaal één succescriterium hebben.");
  }
}
