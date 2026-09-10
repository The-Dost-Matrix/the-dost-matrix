import { describe, expect, it } from "vitest";

import type { MissionV2 } from "./mission";
import {
  buildOwnerClarificationQuestion,
  collectUndeterminedCriteria,
  findLatestBuilderRebuttal,
} from "./owner-clarification";

type Assignment = MissionV2["assignments"][number];
type Criterion = MissionV2["successCriteria"][number];

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    assignmentId: "assignment-1",
    decisionId: "decision-1",
    roleId: "builder",
    status: "COMPLETED",
    objective: "Iets bouwen",
    successCriteria: [],
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
    ...overrides,
  };
}

function criterion(overrides: Partial<Criterion> = {}): Criterion {
  return {
    criterionId: "criterion-1",
    description: "Er is een testbestand",
    status: "PASSED",
    evidenceRefs: [],
    ...overrides,
  } as Criterion;
}

function mission(parts: Partial<MissionV2> = {}): MissionV2 {
  return { assignments: [], successCriteria: [], ...parts } as unknown as MissionV2;
}

describe("collectUndeterminedCriteria", () => {
  it("geeft alleen niet-vast-te-stellen criteria terug, met de toelichting van QA", () => {
    const undetermined = collectUndeterminedCriteria(
      mission({
        successCriteria: [
          criterion({ criterionId: "c1", status: "PASSED" }),
          criterion({
            criterionId: "c2",
            status: "UNDETERMINED",
            description: "De export bestaat",
            lastEvaluationNote: "Kan niet gecontroleerd worden zonder het uit te voeren.",
          }),
          criterion({ criterionId: "c3", status: "FAILED" }),
        ],
      }),
    );

    expect(undetermined).toHaveLength(1);
    expect(undetermined[0].criterionId).toBe("c2");
    expect(undetermined[0].description).toBe("De export bestaat");
    expect(undetermined[0].qaDoubt).toContain("Kan niet gecontroleerd worden");
  });

  it("geeft null als toelichting wanneer QA er geen gaf", () => {
    const undetermined = collectUndeterminedCriteria(
      mission({ successCriteria: [criterion({ status: "UNDETERMINED" })] }),
    );

    expect(undetermined[0].qaDoubt).toBeNull();
  });

  it("geeft een lege lijst wanneer niets onduidelijk is", () => {
    expect(
      collectUndeterminedCriteria(mission({ successCriteria: [criterion({ status: "PASSED" })] })),
    ).toEqual([]);
  });
});

describe("findLatestBuilderRebuttal", () => {
  it("geeft null wanneer er geen afgeronde builder-toewijzing is", () => {
    expect(findLatestBuilderRebuttal(mission())).toBeNull();
  });

  it("negeert toewijzingen van de qa-rol", () => {
    expect(
      findLatestBuilderRebuttal(
        mission({
          assignments: [
            assignment({ roleId: "qa", status: "COMPLETED", resultSummary: "QA-oordeel." }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("negeert een builder-toewijzing zonder samenvatting", () => {
    expect(
      findLatestBuilderRebuttal(
        mission({ assignments: [assignment({ resultSummary: undefined })] }),
      ),
    ).toBeNull();
  });

  it("neemt de MEEST RECENTE afgeronde builder-toewijzing", () => {
    const rebuttal = findLatestBuilderRebuttal(
      mission({
        assignments: [
          assignment({
            assignmentId: "b1",
            createdAt: "2026-09-06T09:00:00.000Z",
            resultSummary: "Eerste poging.",
          }),
          assignment({
            assignmentId: "b2",
            createdAt: "2026-09-06T11:00:00.000Z",
            resultSummary: "Tweede poging: het oordeel van QA klopt niet, want...",
          }),
        ],
      }),
    );

    expect(rebuttal).toBe("Tweede poging: het oordeel van QA klopt niet, want...");
  });

  it("negeert een actieve (nog niet afgeronde) builder-toewijzing", () => {
    expect(
      findLatestBuilderRebuttal(
        mission({
          assignments: [assignment({ status: "ACTIVE", resultSummary: "Nog bezig." })],
        }),
      ),
    ).toBeNull();
  });
});

describe("buildOwnerClarificationQuestion", () => {
  const primary = { criterionId: "c1", description: "De export bestaat", qaDoubt: "Kan niet gecontroleerd worden." };

  it("neemt de intro, het criterium en de twijfel van QA op", () => {
    const question = buildOwnerClarificationQuestion({
      intro: "QA kon dit niet vaststellen.",
      criteria: [primary],
      builderRebuttal: null,
    });

    expect(question).toContain("QA kon dit niet vaststellen.");
    expect(question).toContain('"De export bestaat"');
    expect(question).toContain("Kan niet gecontroleerd worden.");
  });

  it("zegt het wanneer QA geen toelichting gaf", () => {
    const question = buildOwnerClarificationQuestion({
      intro: "Intro",
      criteria: [{ ...primary, qaDoubt: null }],
      builderRebuttal: null,
    });

    expect(question).toContain("geen nadere toelichting");
  });

  it("neemt het weerwoord van de Builder op wanneer beschikbaar", () => {
    const question = buildOwnerClarificationQuestion({
      intro: "Intro",
      criteria: [primary],
      builderRebuttal: "Het bezwaar van QA klopt niet, want de export staat wel degelijk in het bestand.",
    });

    expect(question).toContain("Weerwoord van de Builder");
    expect(question).toContain("de export staat wel degelijk in het bestand");
  });

  it("laat het weerwoord weg wanneer er geen is", () => {
    const question = buildOwnerClarificationQuestion({
      intro: "Intro",
      criteria: [primary],
      builderRebuttal: null,
    });

    expect(question).not.toContain("Weerwoord van de Builder");
  });

  it("noemt overige openstaande criteria zonder ze als leidend te behandelen", () => {
    const question = buildOwnerClarificationQuestion({
      intro: "Intro",
      criteria: [primary, { criterionId: "c2", description: "Tweede criterium", qaDoubt: null }],
      builderRebuttal: null,
    });

    expect(question).toContain("nog 1 ander(e)");
    expect(question).toContain('"Tweede criterium"');
    expect(question).toContain("Los eerst het bovenstaande criterium op");
  });

  it("eindigt met de instructie om te antwoorden met een reden", () => {
    const question = buildOwnerClarificationQuestion({
      intro: "Intro",
      criteria: [primary],
      builderRebuttal: null,
    });

    expect(question).toContain('"gehaald" of "niet gehaald"');
    expect(question).toContain("wordt bij het criterium bewaard");
  });
});
