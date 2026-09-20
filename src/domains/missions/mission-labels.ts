import type { MissionAdvanceOutcome } from "@/core/mission-engine/v2/autonomous-advance";
import type { CiWaitOutcome } from "@/core/mission-engine/v2/ci-wait";
import type { CombinedCheckStatus } from "@/core/mission-engine/v2/github/github-client";
import type { MissionPullRequestState } from "@/core/mission-engine/v2/mission-pr-status";
import type { AssignmentStatus, MissionRiskLevel, MissionV2 } from "@/core/mission-engine/v2/mission";

/**
 * Pure labelfuncties, los van elk paneel. Stonden eerder als lokale functies
 * in mission-engine-v2-panel.tsx; nu ze door meerdere losse panelen worden
 * gebruikt, horen ze op één plek te staan in plaats van gekopieerd te worden.
 */

export function missionStatusLabel(status: MissionV2["status"]): string {
  const labels: Record<MissionV2["status"], string> = {
    DRAFT: "Concept",
    READY: "Klaar om te starten",
    ACTIVE: "Actief",
    WAITING_FOR_ROLE: "Wacht op rol-uitvoering",
    WAITING_FOR_OWNER: "Wacht op jouw input",
    WAITING_FOR_APPROVAL: "Wacht op jouw goedkeuring",
    REPLANNING: "Wordt herpland",
    PAUSED: "Gepauzeerd",
    COMPLETED: "Voltooid",
    FAILED: "Mislukt",
    CANCELLED: "Geannuleerd",
  };

  return labels[status] ?? status;
}

export function assignmentStatusLabel(status: AssignmentStatus): string {
  const labels: Record<AssignmentStatus, string> = {
    ACTIVE: "Actief",
    COMPLETED: "Afgerond",
    FAILED: "Mislukt",
    WAITING_FOR_INPUT: "Wacht op jouw input",
    CANCELLED: "Geannuleerd",
  };

  return labels[status] ?? status;
}

export function advanceStoppedReasonLabel(reason: MissionAdvanceOutcome["stoppedReason"]): string {
  const labels: Record<MissionAdvanceOutcome["stoppedReason"], string> = {
    TERMINAL_OR_WAITING_STATUS: "Missie beëindigd of in wachtstand",
    STEP_LIMIT_REACHED: "Stappenlimiet bereikt",
    DEADLINE_REACHED: "Tijdslimiet bereikt",
    WAITING_FOR_CI: "Wachten tot de CI-controle klaar is",
    DIRECTOR_ERROR: "Fout bij de regisseur",
  };

  return labels[reason] ?? reason;
}

export function ciWaitOutcomeLabel(outcome: CiWaitOutcome): string {
  const labels: Record<CiWaitOutcome, string> = {
    SETTLED: "CI-controle afgerond",
    TIMED_OUT: "Wachttijd voor CI verstreken",
    NO_PULL_REQUEST: "Geen pull request gevonden",
    ERROR: "Fout bij wachten op CI",
  };

  return labels[outcome] ?? outcome;
}

export function advanceOutcomeSummary(outcome: MissionAdvanceOutcome): string {
  const title = outcome.title.replace(/\s+/g, " ").trim();
  const stepsLabel = outcome.stepsTaken === 1 ? "stap" : "stappen";

  return `${title}: ${outcome.stepsTaken} ${stepsLabel} gezet — ${advanceStoppedReasonLabel(outcome.stoppedReason)}`;
}

/**
 * Geschatte kosten tot nu toe — puur informatief. `spentCost` is in USD (zie
 * pricing.ts), het budget staat standaard in EUR (mission-factory.ts). Bewust
 * GEEN omrekening tussen die twee: beide bedragen staan in hun eigen valuta
 * naast elkaar in plaats van een schijnnauwkeurige vergelijking te
 * suggereren. Blokkeert nooit iets.
 */
export function formatMissionCost(mission: MissionV2): string {
  const spent = mission.spentCost.toLocaleString("nl-NL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });

  return `~$${spent} geschat (budget: ${mission.budget.maximumCost} ${mission.budget.currency}, indicatief — blokkeert niets)`;
}

export const RISK_LEVELS: MissionRiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function riskLevelLabel(level: MissionRiskLevel): string {
  const labels: Record<MissionRiskLevel, string> = {
    LOW: "Laag — automatisch mergen blijft mogelijk bij een geïsoleerde wijziging",
    MEDIUM: "Middel — altijd jouw eigen goedkeuring vóór mergen",
    HIGH: "Hoog — altijd jouw eigen goedkeuring vóór mergen",
    CRITICAL: "Kritiek — altijd jouw eigen goedkeuring vóór mergen",
  };

  return labels[level];
}

/** Stap 19: de toestand van de pull request van een missie. */
export function pullRequestStateLabel(state: MissionPullRequestState): string {
  const labels: Record<MissionPullRequestState, string> = {
    OPEN: "Open",
    MERGED: "Gemerged",
    CLOSED: "Gesloten zonder merge",
  };

  return labels[state] ?? state;
}

/**
 * De CI-stand in één regel, mét de namen van de checks die het betreft.
 *
 * Die namen zijn het hele punt. "CI mislukt" stuurt je alsnog naar GitHub;
 * "CI mislukt: Typecheck & import-check" vertelt je meteen waar je moet
 * kijken — en dat is precies wat deze stap moet wegnemen.
 *
 * `null` betekent dat de stand niet opgehaald kon worden. Dat is iets anders
 * dan "geen checks", en het wordt hier bewust ook anders verwoord: het eerste
 * gaat over ons, het tweede over de repository.
 */
export function ciStatusLabel(ci: CombinedCheckStatus | null): string {
  if (!ci) return "CI-stand onbekend — niet op te halen";

  const named = (names: string[]) => (names.length > 0 ? `: ${names.join(", ")}` : "");

  switch (ci.state) {
    case "success":
      return "CI geslaagd";
    case "failure":
      return `CI mislukt${named(ci.failingCheckNames)}`;
    case "pending":
      return `CI loopt nog${named(ci.pendingCheckNames)}`;
    case "unknown":
      return "CI-stand niet op te halen bij GitHub";
    default:
      return "Geen CI-controles geregistreerd voor deze commit";
  }
}

/**
 * De achterstand op de standaardbranch, of een lege string wanneer er niets
 * te melden valt.
 *
 * Een lege string en niet "bij" of "geen achterstand": dit is een
 * waarschuwingsregel, en een waarschuwing die er ook staat als er niets aan de
 * hand is, wordt niet meer gelezen.
 */
export function behindByLabel(behindBy: number | null): string {
  if (behindBy === null || behindBy <= 0) return "";

  const commits = behindBy === 1 ? "1 commit" : `${behindBy} commits`;

  return `Loopt ${commits} achter op de standaardbranch — werk de branch bij, anders weigert QA een oordeel`;
}
