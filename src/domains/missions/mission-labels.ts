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
