import { describe, it, expect } from "vitest";

import {
  AGENT_PRESENCE_FRESH_MS,
  buildAgentStatus,
  describeAge,
  describeAgentPresence,
} from "./agent-presence";

const NU = new Date("2026-09-20T18:00:00.000Z");

function minutenGeleden(minutes: number): string {
  return new Date(NU.getTime() - minutes * 60_000).toISOString();
}

describe("describeAgentPresence", () => {
  it("meldt dat de koppeling niet bestaat wanneer er geen sleutel is", () => {
    const presence = describeAgentPresence({ secretConfigured: false, lastSeenAt: null }, NU);

    expect(presence.present).toBe(false);
    expect(presence.detail).toContain("Geen agentsleutel");
  });

  it("onderscheidt 'ingesteld maar nog nooit gebruikt' van 'niet ingesteld'", () => {
    // Dit is het verschil waar dit hele bestand om draait: dat de deur er is,
    // betekent niet dat er iemand doorheen is gekomen.
    const presence = describeAgentPresence({ secretConfigured: true, lastSeenAt: null }, NU);

    expect(presence.present).toBe(false);
    expect(presence.detail).toContain("nog niet gebruikt");
  });

  it("toont 'actief' bij een recent spoor", () => {
    const presence = describeAgentPresence(
      { secretConfigured: true, lastSeenAt: minutenGeleden(2) },
      NU,
    );

    expect(presence.present).toBe(true);
    expect(presence.detail).toContain("Actief");
    expect(presence.detail).toContain("2 minuten geleden");
  });

  it("valt precies op de grens nog binnen het venster", () => {
    const presence = describeAgentPresence(
      { secretConfigured: true, lastSeenAt: new Date(NU.getTime() - AGENT_PRESENCE_FRESH_MS).toISOString() },
      NU,
    );

    expect(presence.present).toBe(true);
  });

  it("toont alleen nog wanneer, zodra het spoor ouder is dan het venster", () => {
    const presence = describeAgentPresence(
      { secretConfigured: true, lastSeenAt: minutenGeleden(45) },
      NU,
    );

    expect(presence.present).toBe(false);
    expect(presence.detail).toContain("45 minuten geleden");
    expect(presence.detail).not.toContain("Actief");
  });

  it("beweert niets bij een tijdstempel uit de toekomst", () => {
    const presence = describeAgentPresence(
      { secretConfigured: true, lastSeenAt: new Date(NU.getTime() + 60_000).toISOString() },
      NU,
    );

    expect(presence.present).toBe(false);
    expect(presence.detail).toContain("toekomst");
  });

  it("beweert niets bij een onleesbaar tijdstempel", () => {
    const presence = describeAgentPresence(
      { secretConfigured: true, lastSeenAt: "gisteren ergens" },
      NU,
    );

    expect(presence.present).toBe(false);
    expect(presence.detail).toContain("onleesbaar");
  });
});

describe("describeAge", () => {
  it("rekent om naar gewone taal", () => {
    expect(describeAge(0)).toBe("zojuist");
    expect(describeAge(30_000)).toBe("zojuist");
    expect(describeAge(60_000)).toBe("1 minuut geleden");
    expect(describeAge(5 * 60_000)).toBe("5 minuten geleden");
    expect(describeAge(60 * 60_000)).toBe("1 uur geleden");
    expect(describeAge(3 * 60 * 60_000)).toBe("3 uur geleden");
    expect(describeAge(26 * 60 * 60_000)).toBe("1 dag geleden");
    expect(describeAge(72 * 60 * 60_000)).toBe("3 dagen geleden");
  });
});

describe("buildAgentStatus", () => {
  /**
   * De belangrijkste test van dit bestand. summarizeStatusLevel in
   * system-status.ts trekt de samenvatting in de topbar omlaag zodra één
   * onderdeel op DEGRADED staat. Zou "Claude is er even niet" dat doen, dan
   * stond er bijna altijd "BEPERKT" terwijl er niets aan de hand is — en een
   * waarschuwing die altijd afgaat, leest binnen een week niemand meer.
   */
  it("blijft OK wanneer de sleutel is ingesteld, ook als er lang niets langs kwam", () => {
    const status = buildAgentStatus(
      { secretConfigured: true, lastSeenAt: minutenGeleden(600) },
      NU,
    );

    expect(status.level).toBe("OK");
    expect(status.id).toBe("agent");
    expect(status.label).toBe("Claude-koppeling");
  });

  it("is NOT_CONFIGURED zonder sleutel — dan bestaat de koppeling echt niet", () => {
    expect(buildAgentStatus({ secretConfigured: false, lastSeenAt: null }, NU).level).toBe(
      "NOT_CONFIGURED",
    );
  });

  it("zegt 'live' wanneer er een spoor is en 'configuratie' wanneer er niets is", () => {
    expect(
      buildAgentStatus({ secretConfigured: true, lastSeenAt: minutenGeleden(1) }, NU).checkedVia,
    ).toBe("live");
    expect(
      buildAgentStatus({ secretConfigured: false, lastSeenAt: null }, NU).checkedVia,
    ).toBe("configuratie");
  });
});
