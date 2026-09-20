import { describe, it, expect } from "vitest";

import { findUnverifiedCiReason, isCiRequired } from "./ci-policy";
import type { CombinedCheckStatus } from "./github/github-client";

/**
 * Bevinding F-02 uit de externe review van 20 september 2026.
 *
 * Een HTTP 403 van GitHub werd vertaald naar "none", en "none" kwam door
 * alle drie de mergepoorten heen omdat die alleen op "failure" en "pending"
 * blokkeerden. "Ik kan de controle niet lezen" gold daarmee net zo goed als
 * een groene CI. Deze tests leggen het verschil vast.
 */

function status(state: CombinedCheckStatus["state"]): CombinedCheckStatus {
  return { state, failingCheckNames: [], pendingCheckNames: [] };
}

const CONTEXT = {
  pullRequestNumber: 67,
  pullRequestTitle: "Voorbeeld",
  pullRequestUrl: "https://github.com/The-Dost-Matrix/the-dost-matrix/pull/67",
};

describe("isCiRequired", () => {
  it("staat standaard AAN wanneer er niets is ingesteld", () => {
    expect(isCiRequired({})).toBe(true);
  });

  it("gaat alleen uit bij de letterlijke waarde false", () => {
    expect(isCiRequired({ MISSION_REQUIRE_CI: "false" })).toBe(false);
    expect(isCiRequired({ MISSION_REQUIRE_CI: "FALSE" })).toBe(false);
    expect(isCiRequired({ MISSION_REQUIRE_CI: " false " })).toBe(false);
  });

  it("blijft AAN bij een typefout of een onzinwaarde", () => {
    // Een verkeerd gespelde waarde mag de poort niet openzetten — dat is
    // precies het soort stille versoepeling waar deze bevinding over ging.
    expect(isCiRequired({ MISSION_REQUIRE_CI: "fasle" })).toBe(true);
    expect(isCiRequired({ MISSION_REQUIRE_CI: "0" })).toBe(true);
    expect(isCiRequired({ MISSION_REQUIRE_CI: "nee" })).toBe(true);
    expect(isCiRequired({ MISSION_REQUIRE_CI: "" })).toBe(true);
  });
});

describe("findUnverifiedCiReason", () => {
  it("laat een geslaagde CI ongemoeid", () => {
    expect(findUnverifiedCiReason(status("success"), CONTEXT, {})).toBeNull();
  });

  it("bemoeit zich niet met failure en pending — die hebben hun eigen afhandeling", () => {
    expect(findUnverifiedCiReason(status("failure"), CONTEXT, {})).toBeNull();
    expect(findUnverifiedCiReason(status("pending"), CONTEXT, {})).toBeNull();
  });

  it("blokkeert wanneer de stand niet op te halen was", () => {
    const reason = findUnverifiedCiReason(status("unknown"), CONTEXT, {});

    expect(reason).toContain("niet bij GitHub worden opgehaald");
    expect(reason).toContain("#67");
  });

  it("blijft blokkeren bij een onleesbare stand, ook als CI niet verplicht is", () => {
    // Geen CI hebben is iets anders dan de stand niet kunnen lezen. Het
    // tweede is nooit een geldige reden om door te lopen.
    const reason = findUnverifiedCiReason(status("unknown"), CONTEXT, {
      MISSION_REQUIRE_CI: "false",
    });

    expect(reason).not.toBeNull();
  });

  it("blokkeert wanneer er geen controles zijn en CI verplicht is", () => {
    const reason = findUnverifiedCiReason(status("none"), CONTEXT, {});

    expect(reason).toContain("geen CI-controles geregistreerd");
  });

  it("laat 'geen controles' door wanneer het project is vrijgesteld", () => {
    // De uitzondering waar de oude toelichting bij CombinedCheckStatus over
    // ging: een doelproject zonder CI-workflow moet kunnen blijven mergen.
    expect(
      findUnverifiedCiReason(status("none"), CONTEXT, { MISSION_REQUIRE_CI: "false" }),
    ).toBeNull();
  });

  it("noemt de pull request-link zodat de eigenaar meteen verder kan", () => {
    expect(findUnverifiedCiReason(status("none"), CONTEXT, {})).toContain(CONTEXT.pullRequestUrl);
    expect(findUnverifiedCiReason(status("unknown"), CONTEXT, {})).toContain(
      CONTEXT.pullRequestUrl,
    );
  });
});
