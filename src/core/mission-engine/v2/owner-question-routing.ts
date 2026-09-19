import type { MissionV2 } from "./mission";
import { findHardEscalationReason } from "./risk-classification";
import type { PullRequestFileChange } from "./github/github-client";

/**
 * Roadmapstap 22, onderdeel 2 — wie krijgt de ownervraag?
 *
 * WAT DIT OPLOST
 *
 * De lus bestaat al sinds stap 12b: loopt een missie vast op een criterium
 * dat QA niet kan vaststellen, dan stelt de Director de vraag aan zijn
 * eigenaar (PendingOwnerInput) en wacht. Vandaag kan alleen Elroy die
 * beantwoorden, en dat is precies het werk dat hij niet wil doen: uitzoeken
 * of een criterium gehaald is, is een feitelijke vraag over een diff en een
 * testuitslag, geen beslissing die van hem moet komen.
 *
 * Deze module bepaalt per openstaande vraag wie hem hoort te beantwoorden.
 *
 * WAAROM DIT NIET NAAR DE TEKST VAN DE VRAAG KIJKT
 *
 * De verleiding is om in de vraagtekst te zoeken naar woorden als "welke wil
 * je" of "kosten" en daarop te escaleren. Dat is raden, en raden gaat hier
 * twee kanten op fout: te vaak escaleren betekent dat Elroy alsnog alles
 * doet, te weinig betekent dat er namens hem iets wordt besloten wat hij
 * zelf had willen bepalen. Op 19 september 2026 is daarom gekozen voor
 * uitsluitend structurele signalen — dingen die vaststaan in plaats van
 * dingen die geïnterpreteerd moeten worden.
 *
 * DE REGELS, IN VOLGORDE
 *
 * 1. Raakt de bijbehorende pull request de harde escalatiecategorie
 *    (geheimen, GitHub-workflows, authenticatie, Firebase-configuratie, of
 *    een verwijdering), dan gaat de vraag naar Elroy. Deze controle staat
 *    hier voor de volledigheid; het mergen zelf is er al door beschermd, dus
 *    ook als de aanroeper geen bestandslijst meegeeft blijft die grens
 *    staan.
 * 2. Heeft Elroy de missie zelf op MEDIUM, HIGH of CRITICAL gezet, dan gaat
 *    de vraag naar hem. Dat is dezelfde afspraak als in
 *    classifyPullRequestRiskForMission: een risiconiveau dat hij zelf hoger
 *    heeft gezet, verdient zijn eigen blik.
 * 3. Gaat de vraag niet over een specifiek succescriterium
 *    (relatedCriterionId ontbreekt), dan gaat hij naar Elroy. Zo'n generiek
 *    verzoek komt uit een rol die niet verder kon en om richting vraagt —
 *    open van vorm, en meestal een keuze in plaats van een feit.
 * 4. Is er in deze missie al twee keer namens Elroy geantwoord, dan gaat de
 *    derde vraag naar hem. Eén keer vlot trekken is hulp; drie keer op rij
 *    is geen reeks vragen meer maar een missie die niet loopt, en dat hoort
 *    hij te zien.
 * 5. Anders mag de agent antwoorden.
 *
 * WAT DIT NIET IS
 *
 * Geen toestemming om QA te overrulen en geen kortere weg naar mergen. Het
 * antwoord van de agent loopt door exact dezelfde recordOwnerInput heen als
 * dat van Elroy, en alles wat daarna komt — de geautomatiseerde beoordeling,
 * de CI-poort, findHardEscalationReason — staat er onveranderd achter.
 */

export const MAX_AGENT_ANSWERS_PER_MISSION = 2;

/**
 * Het merkteken dat voor elk namens de eigenaar gegeven antwoord komt te
 * staan. Het doet twee dingen tegelijk, en dat is met opzet:
 *
 * 1. Het is zichtbaar. recordOwnerInput bewaart het antwoord als
 *    lastEvaluationNote op het criterium ("Beslissing van de eigenaar: ..."),
 *    en dat staat in Command Center. Elroy ziet daarmee in het scherm zelf
 *    welk criterium door hem is beoordeeld en welk namens hem — zonder dat
 *    daar een nieuw veld of een nieuwe collectie voor nodig is.
 * 2. Het is telbaar. countAgentAnswers hieronder leidt er regel 4 uit af.
 *    Zou de teller in plaats daarvan door de aanroeper worden meegegeven,
 *    dan zou de partij die de grens moet respecteren zelf bepalen hoe dicht
 *    hij erbij zit.
 */
export const AGENT_ANSWER_MARKER = "[namens jou beantwoord door Claude]";

/**
 * Telt hoe vaak er in deze missie al namens de eigenaar is geantwoord, door
 * te kijken naar de sporen die die antwoorden op de succescriteria hebben
 * achtergelaten.
 */
export function countAgentAnswers(mission: MissionV2): number {
  return (mission.successCriteria ?? []).filter((criterion) =>
    criterion.lastEvaluationNote?.includes(AGENT_ANSWER_MARKER),
  ).length;
}

/** Zet het merkteken voor een antwoord, zonder het twee keer toe te voegen. */
export function markAgentAnswer(response: string): string {
  const trimmed = response.trim();

  return trimmed.startsWith(AGENT_ANSWER_MARKER)
    ? trimmed
    : `${AGENT_ANSWER_MARKER} ${trimmed}`;
}

export type OwnerQuestionDestination = "agent" | "owner";

export interface OwnerQuestionRoute {
  destination: OwnerQuestionDestination;
  /** Waarom deze vraag daar hoort. Bedoeld om letterlijk te tonen. */
  reason: string;
}

export interface OwnerQuestionContext {
  /**
   * Hoe vaak er in DEZE missie al namens de eigenaar is geantwoord door de
   * agent. De aanroeper telt dit; deze module houdt geen geschiedenis bij.
   */
  agentAnswersSoFar?: number;
  /**
   * De bestanden in de bijbehorende pull request, wanneer die al bekend zijn.
   * Ontbreken ze, dan wordt regel 1 overgeslagen — niet omdat de grens dan
   * niet geldt, maar omdat hij verderop in het mergepad alsnog wordt
   * afgedwongen.
   */
  pullRequestFiles?: PullRequestFileChange[];
}

/**
 * Bepaalt wie de openstaande ownervraag van deze missie hoort te
 * beantwoorden. Geeft null wanneer er geen vraag openstaat — dan valt er
 * niets te routeren en hoort de aanroeper dat als zodanig te behandelen, niet
 * als een stilzwijgend "nee".
 */
export function routeOwnerQuestion(
  mission: MissionV2,
  context: OwnerQuestionContext = {},
): OwnerQuestionRoute | null {
  const pending = mission.pendingOwnerInput;

  if (!pending) {
    return null;
  }

  if (context.pullRequestFiles && context.pullRequestFiles.length > 0) {
    const hardReason = findHardEscalationReason(context.pullRequestFiles);

    if (hardReason) {
      return { destination: "owner", reason: hardReason };
    }
  }

  if (mission.riskLevel !== "LOW") {
    return {
      destination: "owner",
      reason: `Je hebt deze missie zelf op risiconiveau ${mission.riskLevel} gezet. Vragen binnen zo'n missie beantwoord ik niet namens jou.`,
    };
  }

  if (!pending.relatedCriterionId) {
    return {
      destination: "owner",
      reason:
        "Deze vraag gaat niet over een specifiek succescriterium maar vraagt om richting. Dat is een keuze, geen feit, en die hoort bij jou.",
    };
  }

  const answersSoFar = context.agentAnswersSoFar ?? 0;

  if (answersSoFar >= MAX_AGENT_ANSWERS_PER_MISSION) {
    return {
      destination: "owner",
      reason: `Er is in deze missie al ${answersSoFar} keer namens jou geantwoord. Dat het nóg een keer vastloopt, is geen losse vraag meer maar een missie die niet loopt — die hoor jij te zien.`,
    };
  }

  return {
    destination: "agent",
    reason:
      "Deze vraag gaat over één succescriterium van een missie die je zelf als laag risico hebt aangemerkt. Of dat criterium gehaald is, valt af te lezen aan de wijziging en de testuitslag.",
  };
}
