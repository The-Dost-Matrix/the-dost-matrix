import { describe, expect, it } from "vitest";

import type { MissionV2 } from "./mission";
import {
  MAX_SEMANTIC_REPAIR_ATTEMPTS,
  SEMANTIC_REPAIR_KIND,
  buildSemanticRepairExhaustedMessage,
  buildSemanticRepairObjective,
  buildSemanticRepairReason,
  collectFailedCriteria,
  countSemanticRepairAttempts,
} from "./semantic-repair";

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

describe("countSemanticRepairAttempts", () => {
  it("telt alleen inhoudelijke herstelpogingen", () => {
    const counted = countSemanticRepairAttempts(
      mission({
        assignments: [
          assignment({ assignmentId: "a1" }),
          assignment({ assignmentId: "a2", kind: SEMANTIC_REPAIR_KIND }),
          assignment({ assignmentId: "a3", kind: "TECHNICAL_REPAIR" }),
        ],
      }),
    );

    expect(counted).toBe(1);
  });

  it("telt technische herstelpogingen niet mee", () => {
    const counted = countSemanticRepairAttempts(
      mission({
        assignments: [
          assignment({ assignmentId: "a1", kind: "TECHNICAL_REPAIR" }),
          assignment({ assignmentId: "a2", kind: "TECHNICAL_REPAIR" }),
          assignment({ assignmentId: "a3", kind: "TECHNICAL_REPAIR" }),
        ],
      }),
    );

    expect(counted).toBe(0);
  });

  it("geeft nul bij een missie zonder toewijzingen", () => {
    expect(countSemanticRepairAttempts(mission())).toBe(0);
  });
});

describe("collectFailedCriteria", () => {
  it("geeft alleen afgekeurde criteria terug, met de toelichting van QA", () => {
    const failed = collectFailedCriteria(
      mission({
        successCriteria: [
          criterion({ criterionId: "c1", status: "PASSED" }),
          criterion({
            criterionId: "c2",
            status: "FAILED",
            description: "De CI slaagt",
            lastEvaluationNote: "Niet te controleren op basis van de aangeleverde inhoud.",
          }),
          criterion({ criterionId: "c3", status: "PENDING" }),
        ],
      }),
    );

    expect(failed).toHaveLength(1);
    expect(failed[0].criterionId).toBe("c2");
    expect(failed[0].description).toBe("De CI slaagt");
    expect(failed[0].note).toContain("Niet te controleren");
  });

  it("geeft null als toelichting wanneer QA er geen gaf", () => {
    const failed = collectFailedCriteria(
      mission({ successCriteria: [criterion({ status: "FAILED" })] }),
    );

    expect(failed[0].note).toBeNull();
  });

  it("behandelt een lege toelichting als geen toelichting", () => {
    const failed = collectFailedCriteria(
      mission({ successCriteria: [criterion({ status: "FAILED", lastEvaluationNote: "   " })] }),
    );

    expect(failed[0].note).toBeNull();
  });

  it("geeft een lege lijst wanneer niets is afgekeurd", () => {
    expect(
      collectFailedCriteria(mission({ successCriteria: [criterion({ status: "PASSED" })] })),
    ).toEqual([]);
  });
});

describe("buildSemanticRepairObjective", () => {
  const base = {
    attempt: 1,
    maxAttempts: MAX_SEMANTIC_REPAIR_ATTEMPTS,
    pullRequestNumber: 43,
    changedFilePaths: ["src/core/x.test.ts"],
    failedCriteria: [
      {
        criterionId: "c2",
        description: "De CI-controle slaagt",
        note: "Niet te controleren op basis van de aangeleverde inhoud.",
      },
    ],
  };

  it("noemt de poging, de pull request en de gewijzigde bestanden", () => {
    const objective = buildSemanticRepairObjective(base);

    expect(objective).toContain("poging 1 van 2");
    expect(objective).toContain("#43");
    expect(objective).toContain("- src/core/x.test.ts");
  });

  it("neemt het criterium en het oordeel van QA letterlijk op", () => {
    const objective = buildSemanticRepairObjective(base);

    expect(objective).toContain("De CI-controle slaagt");
    expect(objective).toContain("Niet te controleren op basis van de aangeleverde inhoud.");
  });

  it("zegt het wanneer QA geen toelichting gaf", () => {
    const objective = buildSemanticRepairObjective({
      ...base,
      failedCriteria: [{ criterionId: "c2", description: "Iets", note: null }],
    });

    expect(objective).toContain("QA gaf geen toelichting");
  });

  it("staat de Builder toe het oordeel van QA tegen te spreken", () => {
    const objective = buildSemanticRepairObjective(base);

    expect(objective).toContain("kan onjuist zijn");
    expect(objective).toContain("verander de code dan NIET");
  });

  it("verbiedt het verzwakken of verwijderen van tests", () => {
    expect(buildSemanticRepairObjective(base)).toContain("Verzwak nooit een test");
  });

  it("zegt expliciet dat de Builder niets kan uitvoeren", () => {
    const objective = buildSemanticRepairObjective(base);

    expect(objective).toContain("Je kunt zelf niets uitvoeren");
    expect(objective).toContain("in plaats van te doen alsof je het hebt gedaan");
  });

  it("zegt het expliciet wanneer GitHub geen gewijzigde bestanden gaf", () => {
    expect(
      buildSemanticRepairObjective({ ...base, changedFilePaths: [] }),
    ).toContain("geen gewijzigde bestanden");
  });
});

describe("buildSemanticRepairReason", () => {
  it("gebruikt enkelvoud bij één afgekeurd criterium", () => {
    const reason = buildSemanticRepairReason({
      attempt: 1,
      maxAttempts: 2,
      pullRequestNumber: 43,
      failedCriteriaCount: 1,
    });

    expect(reason).toContain("één succescriterium");
    expect(reason).toContain("herstelpoging 1 van 2");
    expect(reason).toContain("vaste regel");
  });

  it("gebruikt meervoud bij meerdere afgekeurde criteria", () => {
    expect(
      buildSemanticRepairReason({
        attempt: 2,
        maxAttempts: 2,
        pullRequestNumber: 43,
        failedCriteriaCount: 3,
      }),
    ).toContain("3 succescriteria");
  });
});

describe("buildSemanticRepairExhaustedMessage", () => {
  it("noemt de criteria, dat de CI groen is, en alle drie de mogelijke oorzaken", () => {
    const message = buildSemanticRepairExhaustedMessage(2, 43, "https://github.com/x/y/pull/43", [
      { criterionId: "c2", description: "De CI-controle slaagt", note: null },
    ]);

    expect(message).toContain("De CI-controle slaagt");
    expect(message).toContain("CI is groen");
    expect(message).toContain("het bezwaar van QA klopt");
    expect(message).toContain("QA mist context");
    expect(message).toContain("niet te bewijzen valt");
    expect(message).toContain("https://github.com/x/y/pull/43");
  });
});
