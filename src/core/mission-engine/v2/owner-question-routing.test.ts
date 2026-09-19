import { describe, it, expect } from "vitest";

import type { MissionV2 } from "./mission";
import {
  AGENT_ANSWER_MARKER,
  MAX_AGENT_ANSWERS_PER_MISSION,
  countAgentAnswers,
  markAgentAnswer,
  routeOwnerQuestion,
} from "./owner-question-routing";
import type { PullRequestFileChange } from "./github/github-client";

function buildMission(overrides: Partial<MissionV2> = {}): MissionV2 {
  return {
    missionId: "abc12345-0000-0000-0000-000000000000",
    title: "Voorbeeldmissie",
    objective: "Een geïsoleerde utility-functie toevoegen.",
    riskLevel: "LOW",
    successCriteria: [{ description: "De nieuwe functie heeft unit tests." }],
    pendingOwnerInput: {
      requestId: "req-1",
      question: "Is criterium 2 gehaald?",
      requestedAt: "2026-09-19T12:00:00.000Z",
      relatedCriterionId: "criterion-2",
    },
    ...overrides,
  } as unknown as MissionV2;
}

function added(filename: string): PullRequestFileChange {
  return { filename, status: "added", patch: "+iets" };
}

describe("routeOwnerQuestion", () => {
  it("geeft null wanneer er helemaal geen vraag openstaat", () => {
    expect(routeOwnerQuestion(buildMission({ pendingOwnerInput: undefined }))).toBeNull();
  });

  it("laat de agent een criteriumvraag in een LOW-missie beantwoorden", () => {
    const route = routeOwnerQuestion(buildMission());

    expect(route?.destination).toBe("agent");
  });

  it("stuurt een generieke vraag zonder criterium naar de eigenaar", () => {
    const route = routeOwnerQuestion(
      buildMission({
        pendingOwnerInput: {
          requestId: "req-2",
          question: "Welke kant wil je hiermee op?",
          requestedAt: "2026-09-19T12:00:00.000Z",
        },
      }),
    );

    expect(route?.destination).toBe("owner");
    expect(route?.reason).toContain("keuze");
  });

  it("stuurt elke vraag in een missie boven LOW naar de eigenaar", () => {
    for (const riskLevel of ["MEDIUM", "HIGH", "CRITICAL"] as const) {
      const route = routeOwnerQuestion(buildMission({ riskLevel }));

      expect(route?.destination).toBe("owner");
      expect(route?.reason).toContain(riskLevel);
    }
  });

  /**
   * De belangrijkste test van dit bestand, en de reden dat deze regel bestaat.
   * Een koppeling die élke vraag zelf afdoet, verplaatst het probleem alleen:
   * Elroy is dan geen postbode meer, maar ook geen beslisser. Dit is
   * acceptatiepunt 3 uit stap 22 in docs/roadmap.md.
   */
  it("stuurt de vraag naar de eigenaar zodra er al genoeg namens hem is geantwoord", () => {
    const route = routeOwnerQuestion(buildMission(), {
      agentAnswersSoFar: MAX_AGENT_ANSWERS_PER_MISSION,
    });

    expect(route?.destination).toBe("owner");
    expect(route?.reason).toContain("niet loopt");
  });

  it("laat de agent tot aan die grens gewoon antwoorden", () => {
    const route = routeOwnerQuestion(buildMission(), {
      agentAnswersSoFar: MAX_AGENT_ANSWERS_PER_MISSION - 1,
    });

    expect(route?.destination).toBe("agent");
  });

  it("stuurt naar de eigenaar wanneer de pull request de harde categorie raakt", () => {
    const route = routeOwnerQuestion(buildMission(), {
      pullRequestFiles: [added("src/core/firebase/admin.ts")],
    });

    expect(route?.destination).toBe("owner");
    expect(route?.reason).toContain("escaleert");
  });

  it("stuurt naar de eigenaar bij een verwijdering, ook in een LOW-missie", () => {
    const route = routeOwnerQuestion(buildMission(), {
      pullRequestFiles: [{ filename: "src/oud.ts", status: "removed", patch: undefined }],
    });

    expect(route?.destination).toBe("owner");
  });

  it("laat een gewone bestandslijst de agent niet in de weg zitten", () => {
    const route = routeOwnerQuestion(buildMission(), {
      pullRequestFiles: [added("src/core/mission-engine/v2/mission-duration.ts")],
    });

    expect(route?.destination).toBe("agent");
  });

  it("telt de eigen antwoorden en komt zo vanzelf bij de eigenaar uit", () => {
    // De teller komt niet van de aanroeper maar uit de missie zelf: zo kan de
    // partij die de grens moet respecteren niet bepalen hoe dicht hij erbij
    // zit. Hier staan er al twee criteria met het merkteken, dus de derde
    // vraag hoort naar Elroy te gaan.
    const mission = buildMission({
      successCriteria: [
        { description: "a", lastEvaluationNote: `Beslissing van de eigenaar: ${AGENT_ANSWER_MARKER} ja` },
        { description: "b", lastEvaluationNote: `Beslissing van de eigenaar: ${AGENT_ANSWER_MARKER} ja` },
        { description: "c", lastEvaluationNote: "Beslissing van de eigenaar: ja" },
      ],
    } as unknown as Partial<MissionV2>);

    expect(countAgentAnswers(mission)).toBe(2);
    expect(routeOwnerQuestion(mission, { agentAnswersSoFar: countAgentAnswers(mission) })
      ?.destination).toBe("owner");
  });

  it("slaat de bestandscontrole over wanneer er geen lijst is meegegeven", () => {
    // Niet omdat de grens dan niet geldt — het mergepad dwingt hem alsnog af —
    // maar zodat een aanroeper die de bestanden nog niet heeft opgehaald geen
    // GitHub-aanroep hoeft te doen alleen om deze vraag te kunnen routeren.
    expect(routeOwnerQuestion(buildMission(), {})?.destination).toBe("agent");
    expect(routeOwnerQuestion(buildMission(), { pullRequestFiles: [] })?.destination).toBe(
      "agent",
    );
  });
});

describe("markAgentAnswer", () => {
  it("zet het merkteken voor het antwoord", () => {
    expect(markAgentAnswer("Criterium 2 is gehaald.")).toBe(
      `${AGENT_ANSWER_MARKER} Criterium 2 is gehaald.`,
    );
  });

  it("zet het merkteken niet twee keer neer", () => {
    const eenmaal = markAgentAnswer("Criterium 2 is gehaald.");

    expect(markAgentAnswer(eenmaal)).toBe(eenmaal);
  });

  it("telt niets wanneer er nog geen criterium is beoordeeld", () => {
    expect(countAgentAnswers({ successCriteria: [] } as unknown as MissionV2)).toBe(0);
    expect(countAgentAnswers({} as unknown as MissionV2)).toBe(0);
  });
});
