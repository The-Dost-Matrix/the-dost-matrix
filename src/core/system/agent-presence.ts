import type { SystemComponentStatus } from "./system-status";

/**
 * "Claude kijkt mee" — en hoe het scherm dat kan weten.
 *
 * WAAROM DIT NIET UIT DE SLEUTEL AF TE LEIDEN IS
 *
 * Stap 22 gaf de app een tweede ingang met een eigen sleutel. Dat de sleutel
 * bestaat, zegt alleen dat de deur er is; het zegt niets over of er op dit
 * moment iemand doorheen komt. Een lampje dat aan staat zodra de
 * omgevingsvariabele is ingevuld, zou dus altijd branden — en daarmee precies
 * de fout herhalen die in system-status.ts staat beschreven: een scherm dat
 * iets beweert zonder de werkelijkheid te raadplegen.
 *
 * Daarom werkt dit op een spoor in plaats van op een instelling. Elke aanroep
 * met de agentsleutel laat een tijdstempel achter. Is dat tijdstempel recent,
 * dan is er aantoonbaar net nog iemand langs geweest. Is het ouder, dan staat
 * er wanneer, en niets meer dan dat.
 *
 * WAAROM AFWEZIGHEID GEEN STORING IS
 *
 * De statusniveaus hieronder blijven op OK zodra de sleutel is ingesteld, ook
 * wanneer er al uren niets langs is gekomen. Dat is met opzet: dat Claude er
 * even niet is, is de normale toestand van dit systeem en geen defect. Zou dit
 * onderdeel op DEGRADED gaan, dan trekt het via summarizeStatusLevel de hele
 * samenvatting in de topbar mee omlaag, en dan staat er "BEPERKT" terwijl er
 * niets aan de hand is. Een waarschuwing die bijna altijd afgaat, is binnen een
 * week een waarschuwing die niemand meer leest.
 *
 * Ontbreekt de sleutel, dan is NOT_CONFIGURED wél juist: dan bestaat de
 * koppeling niet en kan er niemand langskomen.
 */

/**
 * Hoe lang een spoor "nu" betekent. Tien minuten, en dat getal is niet
 * willekeurig: de autonome missieklok tikt elke tien minuten, dus binnen dat
 * venster is elke aanroep die er hoort te zijn ook echt geweest. Korter zou
 * het bolletje laten knipperen tussen twee handelingen van dezelfde sessie
 * door; langer zou "kijkt mee" gaan zeggen over iemand die allang weg is.
 */
export const AGENT_PRESENCE_FRESH_MS = 10 * 60 * 1000;

export interface AgentPresenceInput {
  /** Of MISSION_AGENT_SECRET is ingesteld — anders bestaat de deur niet. */
  secretConfigured: boolean;
  /** Wanneer er voor het laatst iets met de agentsleutel binnenkwam. */
  lastSeenAt: string | null;
}

export interface AgentPresence {
  /** Of het scherm "Claude kijkt mee" mag tonen. */
  present: boolean;
  /** Mens-leesbaar, altijd feitelijk. Nooit alleen een kleur of een bolletje. */
  detail: string;
}

/** "2 minuten geleden", "3 uur geleden" — tijdzonevrij, dus overal hetzelfde. */
export function describeAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);

  if (minutes < 1) return "zojuist";
  if (minutes === 1) return "1 minuut geleden";
  if (minutes < 60) return `${minutes} minuten geleden`;

  const hours = Math.floor(minutes / 60);

  if (hours === 1) return "1 uur geleden";
  if (hours < 24) return `${hours} uur geleden`;

  const days = Math.floor(hours / 24);

  return days === 1 ? "1 dag geleden" : `${days} dagen geleden`;
}

export function describeAgentPresence(
  input: AgentPresenceInput,
  now: Date = new Date(),
): AgentPresence {
  if (!input.secretConfigured) {
    return { present: false, detail: "Geen agentsleutel ingesteld." };
  }

  if (!input.lastSeenAt) {
    return {
      present: false,
      detail: "Sleutel ingesteld, nog niet gebruikt.",
    };
  }

  const seenAt = new Date(input.lastSeenAt);

  if (Number.isNaN(seenAt.getTime())) {
    return { present: false, detail: "Sleutel ingesteld; tijdstempel onleesbaar." };
  }

  const age = now.getTime() - seenAt.getTime();

  // Een tijdstempel uit de toekomst betekent dat er ergens een klok verkeerd
  // loopt. Dan liever niets beweren dan "kijkt mee" tonen op grond van een
  // waarde die niet kan kloppen.
  if (age < 0) {
    return { present: false, detail: "Tijdstempel ligt in de toekomst — klok controleren." };
  }

  if (age <= AGENT_PRESENCE_FRESH_MS) {
    return { present: true, detail: `Actief — laatst gezien ${describeAge(age)}.` };
  }

  return { present: false, detail: `Laatst gezien ${describeAge(age)}.` };
}

export function buildAgentStatus(
  input: AgentPresenceInput,
  now: Date = new Date(),
): SystemComponentStatus {
  const presence = describeAgentPresence(input, now);

  return {
    id: "agent",
    label: "Claude-koppeling",
    level: input.secretConfigured ? "OK" : "NOT_CONFIGURED",
    detail: presence.detail,
    active: presence.present,
    // "live": dit komt uit een spoor dat een echte aanroep heeft achtergelaten,
    // niet uit het feit dat er een variabele is ingevuld. Precies het
    // onderscheid dat checkedVia in system-status.ts moet bewaken.
    checkedVia: input.secretConfigured ? "live" : "configuratie",
  };
}
