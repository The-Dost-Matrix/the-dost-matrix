import { describe, it, expect } from "vitest";

import {
  AGENT_ALLOWED_ACTIONS,
  MIN_AGENT_SECRET_LENGTH,
  isActionAllowedForAgent,
  resolveAgentOwnerId,
  timingSafeEqualStrings,
} from "./agent-access";

const GELDIG_GEHEIM = "x".repeat(MIN_AGENT_SECRET_LENGTH);
const EIGENAAR = "firebase-uid-van-elroy";

function omgeving(overrides: { secret?: string; ownerId?: string } = {}) {
  return { secret: GELDIG_GEHEIM, ownerId: EIGENAAR, ...overrides };
}

describe("resolveAgentOwnerId", () => {
  it("geeft de eigenaar terug bij een kloppende sleutel", () => {
    expect(resolveAgentOwnerId(GELDIG_GEHEIM, omgeving())).toBe(EIGENAAR);
  });

  it("negeert omliggende spaties, zoals een kopieeractie die achterlaat", () => {
    expect(resolveAgentOwnerId(`  ${GELDIG_GEHEIM}  `, omgeving())).toBe(EIGENAAR);
  });

  it("weigert een sleutel die niet klopt", () => {
    expect(resolveAgentOwnerId("y".repeat(MIN_AGENT_SECRET_LENGTH), omgeving())).toBeNull();
  });

  it("weigert een sleutel die alleen in lengte verschilt", () => {
    expect(resolveAgentOwnerId(`${GELDIG_GEHEIM}x`, omgeving())).toBeNull();
    expect(resolveAgentOwnerId(GELDIG_GEHEIM.slice(0, -1), omgeving())).toBeNull();
  });

  it("weigert een ontbrekende of lege header", () => {
    expect(resolveAgentOwnerId(null, omgeving())).toBeNull();
    expect(resolveAgentOwnerId(undefined, omgeving())).toBeNull();
    expect(resolveAgentOwnerId("", omgeving())).toBeNull();
    expect(resolveAgentOwnerId("   ", omgeving())).toBeNull();
  });

  /**
   * De belangrijkste test van dit bestand. Staat MISSION_AGENT_SECRET niet
   * ingesteld, dan is een lege header gelijk aan een leeg geheim — en zonder
   * deze controle zou "niets meesturen" dan toegang geven tot alle acties op
   * de missies van de eigenaar. Dat is precies het soort fout dat nergens
   * aan opvalt zolang niemand hem probeert.
   */
  it("geeft nooit toegang wanneer het geheim niet is ingesteld", () => {
    expect(resolveAgentOwnerId("", omgeving({ secret: undefined }))).toBeNull();
    expect(resolveAgentOwnerId("", omgeving({ secret: "" }))).toBeNull();
    expect(resolveAgentOwnerId(undefined, omgeving({ secret: undefined }))).toBeNull();
  });

  it("weigert een geheim dat korter is dan de ondergrens", () => {
    const kort = "te-kort";

    expect(resolveAgentOwnerId(kort, omgeving({ secret: kort }))).toBeNull();
  });

  it("geeft niets terug wanneer er geen eigenaar is ingesteld", () => {
    expect(resolveAgentOwnerId(GELDIG_GEHEIM, omgeving({ ownerId: undefined }))).toBeNull();
  });
});

/**
 * Bevinding F-01 uit de externe review van 20 september 2026.
 *
 * De agentsleutel gaf toegang tot dezelfde eigenaar-identiteit, en
 * `approve-and-merge` is juist de actie die géén risicoclassificatie meer
 * uitvoert. Daarmee kon een geautomatiseerde partij precies de wijzigingen
 * mergen die altijd naar Elroy horen te escaleren. Deze tests leggen die
 * grens vast, zodat hij niet stilletjes terug kan komen.
 */
describe("isActionAllowedForAgent", () => {
  it("weigert approve-and-merge", () => {
    expect(isActionAllowedForAgent("approve-and-merge")).toBe(false);
  });

  it("staat de acties toe die de agent wél hoort te kunnen doen", () => {
    for (const action of ["create", "dispatch", "run-role", "auto-step", "cancel"]) {
      expect(isActionAllowedForAgent(action)).toBe(true);
    }
  });

  it("staat answer-owner-input toe — de fijnmazige grens zit in routeOwnerQuestion", () => {
    expect(isActionAllowedForAgent("answer-owner-input")).toBe(true);
  });

  it("weigert een actie die nog niet bestaat", () => {
    // De lijst is een WITTE lijst. Komt er later een actie bij en vergeet
    // iemand hem te beoordelen, dan is het gevolg een geweigerde aanroep en
    // geen stilzwijgend geopende deur.
    expect(isActionAllowedForAgent("delete-everything")).toBe(false);
    expect(isActionAllowedForAgent("")).toBe(false);
  });

  it("noemt approve-and-merge nergens in de toegestane lijst", () => {
    expect(AGENT_ALLOWED_ACTIONS).not.toContain("approve-and-merge");
  });
});

describe("timingSafeEqualStrings", () => {
  it("herkent gelijke tekenreeksen", () => {
    expect(timingSafeEqualStrings("abc", "abc")).toBe(true);
  });

  it("geeft false bij ongelijke lengte in plaats van te werpen", () => {
    expect(() => timingSafeEqualStrings("abc", "abcd")).not.toThrow();
    expect(timingSafeEqualStrings("abc", "abcd")).toBe(false);
  });

  it("gaat goed met meerbyte-tekens", () => {
    expect(timingSafeEqualStrings("sleutelé", "sleutelé")).toBe(true);
    expect(timingSafeEqualStrings("sleutelé", "sleutele")).toBe(false);
  });
});
