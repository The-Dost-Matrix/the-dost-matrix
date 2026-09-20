import type { CombinedCheckStatus } from "./github/github-client";

/**
 * Bevinding F-02 uit de externe review van 20 september 2026 — wanneer telt
 * een CI-stand als een groen licht om te mergen?
 *
 * WAT ER MIS WAS
 *
 * getCombinedCheckStatus vertaalde een HTTP 403 van GitHub naar "none", en
 * nul gevonden checks óók. De drie mergepoorten in director-runtime.ts
 * blokkeerden alleen op "failure" en "pending". Daarmee kwam "ik kan de
 * controle niet lezen" er net zo makkelijk doorheen als een aantoonbaar
 * groene CI — terwijl dat het tegenovergestelde van verificatie is.
 *
 * Het onderscheid tussen "er valt hier niets te controleren" en "ik kan niet
 * zien wat de controle zegt" is nu een zaak van github-client.ts ("none"
 * tegenover "unknown"). Wat die twee betekenen voor het mergen, staat hier.
 *
 * DE AFSPRAAK, GEKOZEN DOOR ELROY OP 20 SEPTEMBER 2026
 *
 * Voor The Dost Matrix zelf is een geslaagde CI verplicht: alleen "success"
 * geeft groen licht. "none" en "unknown" houden een automatische merge tegen
 * en komen bij hem terecht, met de reden erbij.
 *
 * Met één uitzondering, en die is er met opzet: `MISSION_REQUIRE_CI=false`
 * zet de eis uit. Dat is bedoeld voor een toekomstig doelproject zonder
 * CI-workflow — een spelletje, een experiment — waar "geen controles" geen
 * signaal is maar gewoon de werkelijkheid. Precies de situatie die in de
 * oude toelichting bij CombinedCheckStatus werd beschreven, nu als expliciete
 * keuze in plaats van als stilzwijgend gedrag voor iedereen.
 *
 * "unknown" blijft óók zonder die eis blokkeren. Dat is geen repository
 * zonder CI; dat is een repository waarvan we de stand niet konden ophalen,
 * en dat is nooit een geldige reden om door te lopen.
 */

/**
 * De omgeving waarin dit beleid zijn instelling zoekt.
 *
 * Bewust niet NodeJS.ProcessEnv: Next.js breidt dat type uit met een
 * verplichte NODE_ENV, waardoor elke aanroeper — ook een test die alleen deze
 * ene instelling wil nabootsen — een volledige omgeving zou moeten verzinnen.
 *
 * En bewust een index-signature in plaats van één optioneel veld
 * `MISSION_REQUIRE_CI?: string`. Dat laatste leek logischer (een functie hoort
 * niet meer te eisen dan ze leest) maar levert een "weak type" op: een type
 * waarvan élk veld optioneel is. TypeScript weigert daar dan iets aan toe te
 * kennen dat geen enkel veld gemeenschappelijk heeft — en een index-signature
 * telt daarbij niet mee, dus `process.env` viel af met TS2559. Met een
 * index-signature aan deze kant passen `process.env` én een handgemaakt
 * testobject er allebei in.
 */
export interface CiPolicyEnvironment {
  readonly [key: string]: string | undefined;
}

/**
 * Leest de eis uit de omgeving. Standaard AAN: wie niets instelt, krijgt de
 * strengste variant. Alleen de letterlijke waarde "false" zet hem uit, zodat
 * een typefout niet stilzwijgend de poort openzet.
 */
export function isCiRequired(environment: CiPolicyEnvironment = process.env): boolean {
  return (environment.MISSION_REQUIRE_CI ?? "").trim().toLowerCase() !== "false";
}

export interface UnverifiedCiContext {
  pullRequestNumber: number;
  pullRequestTitle: string;
  pullRequestUrl: string;
}

/**
 * Geeft de reden terug waarom er niet gemerged mag worden omdat de CI niet
 * aantoonbaar geslaagd is — of null wanneer die blokkade niet van toepassing
 * is.
 *
 * Behandelt uitsluitend "none" en "unknown". "failure" en "pending" hebben
 * elders al hun eigen, uitgebreidere afhandeling (de technische herstellus
 * respectievelijk wachten), en die blijft onaangeroerd.
 */
export function findUnverifiedCiReason(
  status: CombinedCheckStatus,
  context: UnverifiedCiContext,
  environment: CiPolicyEnvironment = process.env,
): string | null {
  const prefix = `pull request #${context.pullRequestNumber} ("${context.pullRequestTitle}")`;

  if (status.state === "unknown") {
    return `De CI-stand van ${prefix} kon niet bij GitHub worden opgehaald (toegang geweigerd). Dat is iets anders dan een geslaagde controle, dus er wordt niet automatisch gemerged. Bekijk de pull request zelf: ${context.pullRequestUrl}`;
  }

  if (status.state === "none" && isCiRequired(environment)) {
    return `Er zijn geen CI-controles geregistreerd voor de huidige commit van ${prefix}. Voor dit project is een geslaagde CI verplicht, dus er wordt niet automatisch gemerged. Verschijnen de controles alsnog, dan loopt de missie bij de volgende stap vanzelf door; blijven ze uit, bekijk de pull request dan zelf: ${context.pullRequestUrl}`;
  }

  return null;
}
