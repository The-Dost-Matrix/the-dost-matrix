import type { PullRequestFileChange } from "./github/github-client";

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
