import type { PullRequestFileChange } from "./github/github-client";
import type { MissionRiskLevel } from "./mission";

/**
 * Risicoclassificatie voor een pull request van een missie, gebruikt door de
 * Director om te bepalen of hij een gehaalde missie automatisch mag afronden
 * (inclusief het zelf uitvoeren van de merge — zie ensureMissionPullRequestMerged
 * in director-runtime.ts) of dat de eigenaar de wijziging eerst zelf moet
 * beoordelen en mergen.
 *
 * Twee niveaus:
 * - "auto-approve": één geïsoleerd bestand, buiten alle gedeelde/kritieke
 *   locaties — de Director mag zelf mergen zonder tussenkomst.
 * - "needs-signoff": meerdere bestanden tegelijk, een verwijderd bestand, of
 *   een bestand op een gedeelde/kritieke locatie (core-logica, layout,
 *   gedeelde UI-componenten, CI- of projectconfiguratie) — de Director mergt
 *   dan NIET zelf; de eigenaar moet de pull request zelf bekijken en mergen
 *   op GitHub voordat de missie kan worden afgerond.
 *
 * Het derde niveau uit de oorspronkelijke missie-opdracht,
 * "more-context-required" (QA nog niet volledig groen), bestaat al impliciet
 * en heeft geen aparte code nodig: deze classificatie wordt pas aangeroepen
 * nadat hasPassedAllCriteria(mission) al waar is, dus die situatie is op dat
 * moment al uitgesloten.
 *
 * Bewust een eenvoudige, uitlegbare regel op basis van bestandslocaties en
 * -aantal, geen echte import-graafanalyse (dat zou een aparte, grotere
 * bouwstap zijn en is nu niet gebouwd). Bij twijfel kiest deze regel altijd
 * "needs-signoff", nooit "auto-approve" — de veiligste kant om op te
 * fouten.
 */
export type PullRequestRiskLevel = "auto-approve" | "needs-signoff";

export interface PullRequestRiskClassification {
  level: PullRequestRiskLevel;
  reason: string;
}

const CRITICAL_PATH_PATTERNS: RegExp[] = [
  /^src\/core\//i,
  /(^|\/)layout\.tsx?$/i,
  /^src\/components\/ui\//i,
  /(^|\/)shared\//i,
  /(^|\/)middleware\.tsx?$/i,
  /^\.github\//i,
  /(^|\/)package(-lock)?\.json$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)next\.config\.(js|ts|mjs)$/i,
  /(^|\/)tsconfig(\..+)?\.json$/i,
];

function matchesCriticalPath(filename: string): boolean {
  return CRITICAL_PATH_PATTERNS.some((pattern) => pattern.test(filename));
}

export function classifyPullRequestRisk(
  files: PullRequestFileChange[],
): PullRequestRiskClassification {
  if (files.length === 0) {
    return {
      level: "needs-signoff",
      reason:
        "Geen gewijzigde bestanden gevonden bij deze pull request — het risico kan zo niet betrouwbaar worden ingeschat.",
    };
  }

  if (files.length > 1) {
    return {
      level: "needs-signoff",
      reason: `Deze pull request wijzigt ${files.length} bestanden tegelijk — dat is per definitie needs-signoff, ongeacht welke bestanden het zijn.`,
    };
  }

  const [file] = files;

  if (file.status === "removed") {
    return {
      level: "needs-signoff",
      reason: `Bestand "${file.filename}" wordt verwijderd — verwijderingen worden altijd als needs-signoff behandeld.`,
    };
  }

  if (matchesCriticalPath(file.filename)) {
    return {
      level: "needs-signoff",
      reason: `Bestand "${file.filename}" staat op de lijst met gedeelde/kritieke bestandslocaties (core-logica, layout, gedeelde UI-componenten, CI-configuratie of projectconfiguratie).`,
    };
  }

  return {
    level: "auto-approve",
    reason: `Enkel, geïsoleerd bestand "${file.filename}" buiten alle gedeelde/kritieke locaties — geen andere bestanden gewijzigd in dezelfde pull request.`,
  };
}

/**
 * Combineert de bestandsgebaseerde classificatie hierboven met het
 * riskLevel dat op de MISSIE zelf staat (mission.riskLevel — LOW/MEDIUM/
 * HIGH/CRITICAL, gekozen bij het aanmaken van de missie, zie
 * mission-factory.ts en het aanmaakformulier). Tot deze functie werd
 * mission.riskLevel wel opgeslagen maar nergens gelezen — puur decoratief.
 *
 * De regel is bewust eenvoudig en kan alleen VERSCHERPEN, nooit versoepelen
 * ten opzichte van de bestandsgebaseerde classificatie hierboven:
 * - LOW (de standaardwaarde voor elke bestaande en nieuwe missie die niets
 *   anders opgeeft): geen wijziging — de bestandsgebaseerde classificatie
 *   blijft doorslaggevend, exact het gedrag van vóór deze functie bestond.
 * - MEDIUM, HIGH of CRITICAL: altijd "needs-signoff", ongeacht hoe klein of
 *   geïsoleerd de wijziging zelf is. Een missie die de eigenaar zelf als
 *   risicovoller heeft bestempeld (bv. "wijzig het authenticatiesysteem")
 *   verdient een eigen blik, ook als de resulterende pull request toevallig
 *   maar één bestand raakt.
 *
 * Bewust géén automatische merge blokkeren op DISPATCH_ROLE-niveau (dus vóór
 * er zelfs een pull request is) — dat zou een aparte, grotere goedkeurings-
 * stap vereisen (de al bestaande maar nog ongebruikte REQUEST_APPROVAL-flow
 * in engine.ts) waarvoor nog geen scherm bestaat. Deze functie hergebruikt
 * in plaats daarvan het al werkende, geteste needs-signoff-pad: de eigenaar
 * bekijkt en mergt de pull request zelf op GitHub, precies zoals vandaag al
 * gebeurt bij een bestandsgebaseerde needs-signoff-uitkomst.
 */
export function classifyPullRequestRiskForMission(
  files: PullRequestFileChange[],
  missionRiskLevel: MissionRiskLevel,
): PullRequestRiskClassification {
  const fileRisk = classifyPullRequestRisk(files);

  if (missionRiskLevel === "LOW" || fileRisk.level === "needs-signoff") {
    return fileRisk;
  }

  return {
    level: "needs-signoff",
    reason: `Missie-risiconiveau is ${missionRiskLevel} — dat vereist altijd jouw eigen goedkeuring vóór het mergen, ongeacht de bestandsgebaseerde classificatie (die zou hier op zichzelf "auto-approve" zijn geweest: ${fileRisk.reason})`,
  };
}
