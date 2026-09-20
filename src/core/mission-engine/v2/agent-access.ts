import { timingSafeEqual } from "node:crypto";

/**
 * Roadmapstap 22, onderdeel 1 — de deur.
 *
 * WAAROM DIT BESTAAT
 *
 * Alles wat een meewerkende Claude-sessie zou moeten kunnen doen, kan
 * /api/missions/v2 al: missies aanmaken, stappen zetten, ophalen, mergen en
 * ownervragen beantwoorden. Het enige dat ontbrak was een manier om binnen te
 * komen zonder browser. Die route verifieert een Firebase ID-token, en zo'n
 * token kan alleen een ingelogde browser maken.
 *
 * Dat probleem was er eerder al, en is toen op dezelfde manier opgelost:
 * /api/missions/v2/advance wordt door GitHub Actions aangeroepen met een
 * gedeeld geheim in plaats van een token, precies omdat Actions ook geen
 * Firebase-sessie heeft. Dit is hetzelfde patroon, tweede sleutel.
 *
 * WAAROM EEN EIGEN SLEUTEL EN NIET MISSION_ADVANCE_SECRET
 *
 * Die sleutel ligt in de geheimenkluis van GitHub Actions. Deze ligt in een
 * werkomgeving waar een Claude-sessie bij kan. Dat zijn verschillende plekken
 * met verschillende risico's, en dus hoort het verschillende sleutels te
 * zijn: lekt er één, dan kan die worden vervangen zonder de andere weg te
 * gooien. Eén omgevingsvariabele wijzigen en opnieuw uitrollen, meer is het
 * niet.
 *
 * WAAROM EEN EIGEN HEADER EN NIET AUTHORIZATION
 *
 * De browser stuurt haar Firebase-token al als `Authorization: Bearer ...`.
 * Zou deze sleutel dezelfde header gebruiken, dan zou elk binnenkomend
 * ID-token eerst met het geheim worden vergeleken. Dat is onnodig en
 * verwarrend. Een eigen header houdt de twee wegen volledig gescheiden: wat
 * in `x-matrix-agent-key` staat is nooit een gebruikerstoken, en wat in
 * `Authorization` staat wordt nooit met het geheim vergeleken.
 *
 * WAT DEZE SLEUTEL NIET DOET
 *
 * Hij maakt de houder geen eigenaar. Hij geeft toegang tot dezelfde acties
 * die de ingelogde eigenaar heeft, op de missies van dezelfde ene eigenaar —
 * niet meer. De harde escalatiecategorie uit findHardEscalationReason
 * (geheimen, GitHub-workflows, authenticatie, Firebase-configuratie en elke
 * bestandsverwijdering) blijft onverkort gelden voor alles wat langs deze weg
 * wordt aangeraakt. Deze sleutel opent een deur; hij verplaatst geen muren.
 */

export const AGENT_KEY_HEADER = "x-matrix-agent-key";

/**
 * Ondergrens voor de sleutel zelf. Niet omdat 32 tekens een magische waarde
 * is, maar omdat een geheim dat per ongeluk op "test" of op een leeg
 * gebleven variabele staat nooit een deur mag openen. Een sleutel die hier
 * niet doorheen komt, wordt behandeld alsof hij niet bestaat — dan valt de
 * aanroep terug op het Firebase-token en krijgt hij netjes een 401.
 */
export const MIN_AGENT_SECRET_LENGTH = 32;

export type RequestActor = "owner" | "agent";

/**
 * Welke acties een houder van de agentsleutel mág uitvoeren.
 *
 * WAAROM DIT EEN WITTE LIJST IS EN GEEN ZWARTE
 *
 * Bevinding F-01 uit de externe review van 20 september 2026, en ze klopte.
 * Op 19 september is de agentsleutel gebouwd als tweede weg naar dezelfde
 * eigenaar-identiteit, met de redenering "daaronder verandert er niets, alle
 * bestaande grenzen blijven staan". Dat gold niet voor één actie.
 *
 * `approve-and-merge` is namelijk precies de actie die géén risicoclassificatie
 * meer uitvoert — zie approveAndMergeMissionPullRequest in director-runtime.ts:
 * de klik van de eigenaar ís daar de goedkeuring. Dat klopte zolang er maar
 * één manier was om die knop te bereiken. Met de agentsleutel erbij kon een
 * geautomatiseerde partij langs precies de grens die voor haar bedoeld is:
 * de harde escalatiecategorie (geheimen, GitHub-workflows, authenticatie,
 * Firebase-configuratie en elke bestandsverwijdering) escaleert altijd naar
 * Elroy, ongeacht wat een geautomatiseerde beoordeling ervan vindt. Via deze
 * route hoefde die beoordeling niet eens plaats te vinden.
 *
 * De overgebleven poorten — alle succescriteria op GEHAALD, en CI niet
 * mislukt of nog bezig — zijn geen vervanging daarvoor: ze zeggen iets over
 * of de wijziging wérkt, niet over of iemand hem had mogen goedkeuren.
 *
 * Een witte lijst in plaats van een zwarte, zodat een actie die hier later
 * bijkomt standaard gesloten is voor de agent. Een vergeten regel levert dan
 * een geweigerde aanroep op in plaats van een stilzwijgend open deur.
 */
export const AGENT_ALLOWED_ACTIONS: readonly string[] = [
  "create",
  "dispatch",
  "run-role",
  "auto-step",
  "cancel",
  // Wel toegestaan, maar niet onbeperkt: routeOwnerQuestion bepaalt per vraag
  // of de agent hem mag beantwoorden (zie owner-question-routing.ts).
  "answer-owner-input",
];

export function isActionAllowedForAgent(action: string): boolean {
  return AGENT_ALLOWED_ACTIONS.includes(action);
}

/**
 * Vergelijkt twee tekenreeksen zonder dat de tijd die dat kost iets verraadt
 * over hoeveel tekens er klopten. Gelijk aan de implementatie in
 * /api/missions/v2/advance, en om dezelfde reden.
 *
 * timingSafeEqual gooit een fout bij ongelijke lengtes in plaats van false
 * terug te geven, dus de lengte wordt eerst apart vergeleken. Daarmee lekt
 * een lengteverschil nog steeds (zeer beperkte) timinginformatie; dat is
 * onvermijdelijk zonder de werkelijke lengte van het geheim te verbergen.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}

export interface AgentAccessEnvironment {
  secret?: string;
  ownerId?: string;
}

function readEnvironment(): AgentAccessEnvironment {
  return {
    secret: process.env.MISSION_AGENT_SECRET,
    ownerId: process.env.MISSION_AGENT_OWNER_ID ?? process.env.MISSION_ADVANCE_OWNER_ID,
  };
}

/**
 * Geeft de eigenaar-UID terug wanneer deze aanroep een geldige agentsleutel
 * meestuurt, en anders null. Null betekent uitsluitend "niet langs deze weg"
 * — de aanroeper valt dan terug op het Firebase-token, zodat een browser
 * nooit een ander antwoord krijgt dan voorheen.
 *
 * MISSION_AGENT_OWNER_ID mag de eigenaar apart vastleggen; staat hij er niet,
 * dan wordt MISSION_ADVANCE_OWNER_ID gebruikt. Dat is dezelfde Firebase-UID
 * van dezelfde ene eigenaar, al ingesteld voor de autonome tik, en het scheelt
 * een variabele die op twee plekken hetzelfde moet blijven.
 */
export function resolveAgentOwnerId(
  headerValue: string | null | undefined,
  environment: AgentAccessEnvironment = readEnvironment(),
): string | null {
  const { secret, ownerId } = environment;

  if (!secret || secret.length < MIN_AGENT_SECRET_LENGTH) {
    return null;
  }

  if (!ownerId) {
    return null;
  }

  const provided = headerValue?.trim();

  if (!provided) {
    return null;
  }

  return timingSafeEqualStrings(provided, secret) ? ownerId : null;
}
