import { describe, it, expect } from "vitest";

import {
  MIN_AGENT_SECRET_LENGTH,
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
