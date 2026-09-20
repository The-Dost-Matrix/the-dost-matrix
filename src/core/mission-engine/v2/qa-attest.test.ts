import { describe, it, expect } from "vitest";

import type { MissionV2 } from "./mission";
import {
  buildReviewedShaRef,
  collectQaReviewedShas,
  findStaleQaReason,
} from "./qa-attest";

const PR = {
  number: 68,
  title: "Voorbeeld",
  url: "https://github.com/The-Dost-Matrix/the-dost-matrix/pull/68",
  headSha: "aaaaaaa1111111111111111111111111111111111",
};

function mission(
  criteria: {
    status?: string;
    evidenceRefs?: string[];
  }[],
): MissionV2 {
  return {
    successCriteria: criteria.map((criterion, index) => ({
      criterionId: `c${index}`,
      description: `criterium ${index}`,
      status: criterion.status ?? "PASSED",
      evidenceRefs: criterion.evidenceRefs ?? [],
    })),
  } as unknown as MissionV2;
}

describe("collectQaReviewedShas", () => {
  it("vindt de beoordeelde commit tussen de overige bewijsverwijzingen", () => {
    const found = collectQaReviewedShas(
      mission([{ evidenceRefs: ["result-123", buildReviewedShaRef(PR.headSha)] }]),
    );

    expect(found).toEqual([PR.headSha]);
  });

  it("negeert criteria die niet gehaald zijn", () => {
    // Een niet-gehaald criterium houdt de missie al tegen; op welke commit dat
    // oordeel rustte doet er voor het mergen niet meer toe.
    const found = collectQaReviewedShas(
      mission([{ status: "FAILED", evidenceRefs: [buildReviewedShaRef("bbb")] }]),
    );

    expect(found).toEqual([]);
  });

  it("ontdubbelt wanneer alle criteria op dezelfde commit zijn beoordeeld", () => {
    const ref = buildReviewedShaRef(PR.headSha);

    expect(collectQaReviewedShas(mission([{ evidenceRefs: [ref] }, { evidenceRefs: [ref] }]))).toEqual([
      PR.headSha,
    ]);
  });
});

describe("findStaleQaReason", () => {
  it("laat door wanneer QA precies deze commit heeft beoordeeld", () => {
    const reason = findStaleQaReason(
      mission([{ evidenceRefs: [buildReviewedShaRef(PR.headSha)] }]),
      PR,
    );

    expect(reason).toBeNull();
  });

  /**
   * Het scenario uit de review: QA beoordeelt commit A, daarna wordt commit B
   * op dezelfde pull request gezet. De criteria staan nog op GEHAALD en de CI
   * op B is groen — zonder deze controle zou B gemergd worden zonder dat er
   * ooit iemand inhoudelijk naar gekeken heeft.
   */
  it("blokkeert wanneer er sinds het oordeel een nieuwe commit is gekomen", () => {
    const reason = findStaleQaReason(
      mission([{ evidenceRefs: [buildReviewedShaRef("ccccccc2222222222222222222222222222222222")] }]),
      PR,
    );

    expect(reason).toContain("ccccccc");
    expect(reason).toContain("aaaaaaa");
    expect(reason).toContain(PR.url);
  });

  it("blokkeert wanneer de criteria op verschillende commits zijn beoordeeld", () => {
    const reason = findStaleQaReason(
      mission([
        { evidenceRefs: [buildReviewedShaRef(PR.headSha)] },
        { evidenceRefs: [buildReviewedShaRef("ddddddd3333333333333333333333333333333333")] },
      ]),
      PR,
    );

    expect(reason).toContain("niet allemaal op dezelfde commit");
  });

  /**
   * Bewust gedrag, en de enige zwakke plek in deze reparatie: een missie die
   * al liep vóór deze wijziging heeft geen commit bij haar criteria staan.
   * Daar valt niets uit af te leiden, dus houdt dit niets tegen.
   */
  it("houdt een missie van vóór deze wijziging niet tegen", () => {
    expect(findStaleQaReason(mission([{ evidenceRefs: ["result-123"] }]), PR)).toBeNull();
    expect(findStaleQaReason(mission([]), PR)).toBeNull();
  });
});
