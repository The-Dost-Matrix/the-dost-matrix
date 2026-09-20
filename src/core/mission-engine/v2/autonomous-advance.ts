import { waitForMissionChecks } from "./ci-wait";
import { runDirectorStep, DirectorRuntimeError } from "./director-runtime";
import { createMissionEngineV2 } from "./engine-factory";
import {
  FAILURE_ISSUE_LABEL,
  buildFailureIssueBody,
  buildFailureIssueTitle,
  findExistingFailureIssue,
  isReportableFailure,
} from "./failure-report";
import { listMissionsForOwner } from "./firestore-store";
import { createIssue, getGithubRepoTarget, listOpenIssues } from "./github/github-client";
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
 *
 * WAAROM DEZE LUS STOPT NA EEN BUILDER-STAP (14 september 2026)
 *
 * Gevonden bij het uitwerken van stap 18 (deel 4). De CI-poort van dit
 * project was op papier dicht: QA weigert te oordelen zolang checks nog
 * lopen (`state === "pending"`, zie qa-runtime.ts) en de Director weigert te
 * mergen bij een rode CI (`planMissionRepair` in director-runtime.ts). In de
 * autonome lus hieronder stond hij in de praktijk toch open, en wel door een
 * race die geen van beide controles kón zien.
 *
 * Deze lus doet tot 25 stappen binnen één aanroep, achter elkaar. De Builder
 * schrijft bestanden, commit ze en opent de pull request — en een paar
 * seconden later beslist de Director alweer wat er daarna moet gebeuren.
 * GitHub heeft op dat moment nog geen enkele check-run voor die commit
 * geregistreerd. `getCombinedCheckStatus` geeft dan niet "pending" terug
 * maar "none" (total_count === 0), en "none" betekent daar bewust "deze
 * repository heeft geen CI" — een toestand die nooit mag blokkeren, anders
 * zou een missie in een repository zónder CI nooit meer kunnen afronden.
 *
 * Het gevolg: QA beoordeelde code die nog nooit gecompileerd was, en kon
 * alle succescriteria op GEHAALD zetten. De merge-poort ving dat verderop
 * alsnog af, dus er is nooit iets kapots gemerged — maar er ging wel elke
 * keer een volledige QA-ronde verloren, en in het missiepaneel stond
 * ondertussen "alle criteria GEHAALD" op werk dat de typecheck nog moest
 * doorstaan. Precies het beeld waar `getCombinedCheckStatus` ooit voor
 * gebouwd is, terug via een achterdeur.
 *
 * De oplossing is niet nóg een controle maar een pauze: na een
 * builder-toewijzing stopt deze lus met deze missie en laat de volgende tik
 * (~10 minuten later) het werk oppakken. Tegen die tijd heeft GitHub de
 * check-run wél geregistreerd en afgerond, en werken alle bestaande
 * controles zoals ze bedoeld zijn — "none" betekent dan weer wat het hoort
 * te betekenen.
 *
 * De prijs is één extra tik per builder-stap. Bij een missie met twee
 * builder-stappen is dat 's nachts twintig minuten extra, tegen een
 * bespaarde QA-ronde per keer. Dat is geen afweging maar winst.
 *
 * AANVULLING (15 september 2026): die prijs bleek geen tien minuten
 *
 * De aanname hierboven was dat de volgende tik tien minuten later komt. Dat
 * klopt niet. GitHub noemt zijn schedule-trigger "best effort" en knijpt hem
 * hard af: in de eerste dag stonden er elf runs waar er honderden hadden
 * moeten staan, uren uit elkaar, en een overgeslagen run laat geen spoor na.
 * Elke pauze werd daarmee geen tien minuten maar een paar uur.
 *
 * Daarom wordt er nu binnen dezelfde aanroep gewacht tot de CI klaar is (zie
 * ci-wait.ts). Lukt dat, dan loopt de missie in één tik door van bouwen naar
 * QA naar mergen. Lukt het niet, dan valt alles terug op precies het gedrag
 * hierboven: stoppen met WAITING_FOR_CI, en de volgende tik pakt hem op. Het
 * wachten is een versnelling, geen voorwaarde — de pauze zelf blijft de
 * garantie.
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
    | "WAITING_FOR_CI"
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

/**
 * De rol van een toewijzing, of null wanneer die niet gevonden wordt.
 *
 * Wordt opgezocht vóór het uitvoeren, niet erna: `executeRoleAssignment`
 * geeft een bijgewerkte missie terug waarin de toewijzing al is afgerond, en
 * een afgeronde toewijzing is een minder betrouwbaar aanknopingspunt dan de
 * stand van vlak ervoor.
 *
 * De `Array.isArray`-controle is er voor missies die hier zonder
 * toewijzingenlijst binnenkomen (oudere documenten, testdubbels). Onbekend
 * telt dan als "geen builder" en dus als "niet pauzeren" — fail-open, in lijn
 * met de rest van dit bestand: bij twijfel doorgaan met minder zekerheid
 * liever dan een missie laten stilvallen op een ontbrekend veld.
 */
function findAssignmentRoleId(mission: MissionV2, assignmentId: string): string | null {
  if (!Array.isArray(mission.assignments)) return null;

  return (
    mission.assignments.find((assignment) => assignment.assignmentId === assignmentId)?.roleId ??
    null
  );
}

/**
 * De rol die code schrijft en commit. Zie role-runtime.ts, waar dezelfde
 * letterlijke waarde bepaalt welke runtime een toewijzing uitvoert.
 */
const BUILDER_ROLE_ID = "builder";

/**
 * Wacht na een builder-stap op de CI-uitkomst, en zegt of de lus door mag.
 *
 * Alleen een afgeronde uitkomst geeft groen licht om door te gaan — niet
 * omdat die groen zou zijn (daar beslist de Director over), maar omdat er dan
 * íets vaststaat om over te beslissen. Een missie zonder pull request heeft
 * niets om op te wachten en mag ook door.
 *
 * Alles daaronder (tijd op, GitHub onbereikbaar) betekent stoppen, en dan
 * geldt het oorspronkelijke gedrag: de volgende tik pakt de missie op.
 */
async function mayContinueAfterBuilderStep(
  missionId: string,
  deadlineAt: number,
): Promise<boolean> {
  const outcome = await waitForMissionChecks(missionId, { deadlineAt });

  return outcome === "SETTLED" || outcome === "NO_PULL_REQUEST";
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

        const roleId = findAssignmentRoleId(current, assignmentId);

        const { mission: afterRole } = await executeRoleAssignment({
          engine,
          missionId: current.missionId,
          assignmentId,
        });
        current = afterRole;
        steps += 1;

        if (roleId === BUILDER_ROLE_ID && !(await mayContinueAfterBuilderStep(
          current.missionId,
          deadlineAt,
        ))) {
          return {
            missionId: mission.missionId,
            title: mission.title,
            startStatus,
            endStatus: current.status,
            stepsTaken: steps,
            stoppedReason: "WAITING_FOR_CI",
          };
        }

        continue;
      }

      if (current.status === "WAITING_FOR_ROLE") {
        const assignmentId = resolveActiveAssignmentId(current);
        if (!assignmentId) break;

        const roleId = findAssignmentRoleId(current, assignmentId);

        const { mission: afterRole } = await executeRoleAssignment({
          engine,
          missionId: current.missionId,
          assignmentId,
        });
        current = afterRole;
        steps += 1;

        if (roleId === BUILDER_ROLE_ID && !(await mayContinueAfterBuilderStep(
          current.missionId,
          deadlineAt,
        ))) {
          return {
            missionId: mission.missionId,
            title: mission.title,
            startStatus,
            endStatus: current.status,
            stepsTaken: steps,
            stoppedReason: "WAITING_FOR_CI",
          };
        }

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
 * Meldt een vastgelopen missie als GitHub-issue.
 *
 * WAAROM DIT HIER STAAT EN NIET IN DE UI
 *
 * Dit is het pad dat draait terwijl er niemand kijkt. Valt een missie hier
 * stil, dan staat de reden in het logboek van een Actions-run die alleen de
 * eigenaar kan openklappen — en op 20 september 2026 bleek dat in de praktijk
 * te betekenen dat hij zelf de foutmelding moest opzoeken en overtypen.
 * Een issue blijft staan, is leesbaar voor iedereen die de repository kan
 * zien, en verdwijnt niet met de volgende run.
 *
 * Alles hier is best-effort: kan GitHub niet worden bereikt, dan wordt dat
 * gelogd en verder genegeerd. Een melding die niet verstuurd kan worden, mag
 * nooit een missie of een tik laten mislukken — dat zou een logboekfunctie
 * belangrijker maken dan het werk zelf.
 */
async function reportMissionFailure(outcome: MissionAdvanceOutcome): Promise<void> {
  const failure = {
    missionId: outcome.missionId,
    title: outcome.title,
    status: outcome.endStatus,
    stoppedReason: outcome.stoppedReason,
    errorCode: outcome.errorCode,
    errorMessage: outcome.errorMessage,
  };

  // Eerst beslissen óf dit een storing is, en pas daarna GitHub aanroepen.
  // Deze volgorde is niet toevallig: een nette escalatie naar Elroy komt hier
  // vaker langs dan wat dan ook, en die mag geen netwerkaanroep kosten en al
  // helemaal geen issue opleveren. Zie isReportableFailure voor het waarom.
  if (!isReportableFailure(failure)) return;

  try {
    const target = getGithubRepoTarget();
    const openIssues = await listOpenIssues(target);

    // Bestaat er al een melding voor deze missie, dan niets doen. Zonder deze
    // controle opent elke tik van de klok een nieuw issue voor hetzelfde
    // probleem.
    if (findExistingFailureIssue(openIssues, outcome.missionId)) return;

    const issue = await createIssue(target, {
      title: buildFailureIssueTitle(failure),
      body: buildFailureIssueBody(failure),
      labels: [FAILURE_ISSUE_LABEL],
    });

    console.warn("Vastgelopen missie gemeld als GitHub-issue", {
      missionId: outcome.missionId,
      issueUrl: issue.url,
    });
  } catch (error) {
    console.error("Vastgelopen missie kon niet als issue worden gemeld", {
      missionId: outcome.missionId,
      error: error instanceof Error ? error.message : error,
    });
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

    await reportMissionFailure(outcome);

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
