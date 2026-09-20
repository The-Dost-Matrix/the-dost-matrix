import { describe, it, expect } from "vitest";

import {
  MAX_FAILURE_DETAIL_CHARS,
  buildFailureIssueBody,
  buildFailureIssueTitle,
  findExistingFailureIssue,
  type MissionFailure,
} from "./failure-report";

const MOMENT = new Date("2026-09-20T22:15:00.000Z");

function failure(overrides: Partial<MissionFailure> = {}): MissionFailure {
  return {
    missionId: "b3116e6b-0a26-4c6e-936f-f60ce6b171f1",
    title: "Wachttijd op eigenaarsantwoord berekenen",
    status: "WAITING_FOR_ROLE",
    stoppedReason: "DIRECTOR_ERROR",
    errorCode: "ROLE_REFUSED",
    errorMessage: "De Builder kon het bestand niet schrijven omdat hij informatie mist.",
    ...overrides,
  };
}

describe("buildFailureIssueTitle", () => {
  it("draagt het missie-id, want daarop wordt herkend", () => {
    const title = buildFailureIssueTitle(failure());

    expect(title).toContain("b3116e6b-0a26-4c6e-936f-f60ce6b171f1");
    expect(title).toContain("Wachttijd op eigenaarsantwoord berekenen");
  });
});

describe("buildFailureIssueBody", () => {
  it("zet de feiten erin die nodig zijn om te begrijpen wat er misging", () => {
    const body = buildFailureIssueBody(failure(), MOMENT);

    expect(body).toContain("WAITING_FOR_ROLE");
    expect(body).toContain("DIRECTOR_ERROR");
    expect(body).toContain("informatie mist");
    expect(body).toContain("2026-09-20T22:15:00.000Z");
  });

  /**
   * De foutcode is het enige veld waarmee twee meldingen van elkaar te
   * onderscheiden zijn zonder de vrije tekst te lezen. Hij mag dus niet
   * stilletjes wegvallen.
   */
  it("zet de foutcode van de Director erin", () => {
    expect(buildFailureIssueBody(failure(), MOMENT)).toContain("ROLE_REFUSED");
  });

  it("zegt het eerlijk wanneer er geen foutcode is vastgelegd", () => {
    const body = buildFailureIssueBody(failure({ errorCode: undefined }), MOMENT);

    expect(body).toContain("geen code vastgelegd");
  });

  it("zegt het eerlijk wanneer er geen foutmelding is vastgelegd", () => {
    const body = buildFailureIssueBody(failure({ errorMessage: undefined }), MOMENT);

    expect(body).toContain("Geen foutmelding vastgelegd");
  });

  /**
   * De repository is publiek. Een foutmelding die onbeperkt lang mag zijn,
   * kan in theorie een half promptblok meenemen — en daar kan van alles in
   * staan. Afkappen beperkt de schade, en het afkappen wordt gemeld, want dat
   * is de les van deze hele week.
   */
  it("kapt een uitzonderlijk lange foutmelding af en meldt dat", () => {
    const body = buildFailureIssueBody(
      failure({ errorMessage: "x".repeat(MAX_FAILURE_DETAIL_CHARS + 500) }),
      MOMENT,
    );

    expect(body).toContain("afgekapt");
    expect(body).not.toContain("x".repeat(MAX_FAILURE_DETAIL_CHARS + 1));
  });

  it("zwijgt over afkappen wanneer er niets is afgekapt", () => {
    expect(buildFailureIssueBody(failure(), MOMENT)).not.toContain("afgekapt");
  });
});

describe("findExistingFailureIssue", () => {
  const bestaand = {
    number: 7,
    title: "Missie vastgelopen: Iets anders (b3116e6b-0a26-4c6e-936f-f60ce6b171f1)",
    url: "https://github.com/The-Dost-Matrix/the-dost-matrix/issues/7",
  };

  /**
   * De reden dat deze functie bestaat: zonder haar opent elke tik van de
   * missieklok een nieuw issue voor dezelfde vastgelopen missie. Na een nacht
   * staan er dan tien identieke meldingen en leest niemand ze nog.
   */
  it("herkent een openstaande melding aan het missie-id, niet aan de titel", () => {
    // De titel van het bestaande issue wijkt af — de missie is hernoemd.
    expect(findExistingFailureIssue([bestaand], "b3116e6b-0a26-4c6e-936f-f60ce6b171f1")).toEqual(
      bestaand,
    );
  });

  it("geeft null wanneer er nog geen melding voor deze missie is", () => {
    expect(findExistingFailureIssue([bestaand], "een-ander-missie-id")).toBeNull();
  });

  it("geeft null bij een lege lijst", () => {
    expect(findExistingFailureIssue([], "b3116e6b")).toBeNull();
  });
});
