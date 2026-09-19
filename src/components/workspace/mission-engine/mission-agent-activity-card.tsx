"use client";

import {
  collectAgentAnswers,
  type AgentAnswerRecord,
} from "@/core/mission-engine/v2/owner-question-routing";
import type { MissionV2 } from "@/core/mission-engine/v2/mission";

/**
 * Roadmapstap 22, onderdeel 3 — "Wat Claude namens jou heeft gedaan".
 *
 * WAT DIT WEL EN NIET IS
 *
 * Een uitkijkpost, geen bediening. Hier staat wat er in deze missie namens de
 * eigenaar is beantwoord, wanneer, en wat het criterium daarna werd. Er zit
 * geen knop bij: het terugdraaien van een oordeel hoort thuis bij het
 * oordeel zelf, niet in een overzicht ernaast.
 *
 * WAAROM ER GEEN LOGBOEK ACHTER ZIT
 *
 * Dit leest uit de missie zelf — uit de toelichting die recordOwnerInput al
 * op elk criterium achterlaat, herkenbaar aan het merkteken uit
 * owner-question-routing.ts. Een apart logboek naast de werkelijkheid kan
 * ervan gaan afwijken zonder dat iemand het merkt; dit kan dat niet, want het
 * is dezelfde regel tekst die het criterium zelf draagt.
 *
 * Staat er niets namens de eigenaar beantwoord, dan toont dit blok niets —
 * geen lege kaart met "nog geen activiteit". Zie ook de toelichting boven
 * mission-progress.ts: een scherm dat iets toont wat er niet is, is precies
 * wat hier eerder is weggehaald.
 */

function formatMoment(value: string | null): string {
  if (!value) return "tijdstip niet vastgelegd";

  const moment = new Date(value);

  if (Number.isNaN(moment.getTime())) return "tijdstip niet leesbaar";

  return moment.toLocaleString("nl-NL", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function outcomeLabel(outcome: string | undefined): string | null {
  if (outcome === "PASSED") return "gehaald";
  if (outcome === "FAILED") return "niet gehaald";
  return null;
}

export function MissionAgentActivityCard({ mission }: { mission: MissionV2 | null }) {
  const answers: AgentAnswerRecord[] = mission ? collectAgentAnswers(mission) : [];

  if (answers.length === 0) return null;

  return (
    <article className="knowledge-card">
      <strong>Wat Claude namens jou heeft gedaan</strong>

      <ul>
        {answers.map((answer, index) => {
          const label = outcomeLabel(answer.outcome);

          return (
            <li key={answer.criterionId ?? index}>
              <span>{answer.description}</span>
              {label && <span> — {label}</span>}
              <p>{answer.answer}</p>
              <small className="muted">{formatMoment(answer.answeredAt)}</small>
            </li>
          );
        })}
      </ul>

      <small className="muted">
        Beantwoord volgens de routeringsregel uit stap 22. Vragen over smaak,
        prioriteit of risico komen bij jou terecht, en na twee antwoorden namens
        jou gaat de volgende vraag sowieso naar jou.
      </small>
    </article>
  );
}
