import { describe, expect, it, vi } from "vitest";

import {
  buildFirestoreStatus,
  buildGithubStatus,
  buildLlmStatus,
  findMissingGithubAppEnvVars,
  summarizeStatusLevel,
  type SystemComponentStatus,
} from "./system-status";

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("buildLlmStatus", () => {
  it("toont het daadwerkelijk actieve model, met provider ervoor", () => {
    const status = buildLlmStatus({ provider: "anthropic", model: "claude-opus-5" });

    expect(status.level).toBe("OK");
    expect(status.detail).toBe("anthropic/claude-opus-5");
    expect(status.checkedVia).toBe("configuratie");
  });

  it("meldt NOT_CONFIGURED wanneer er geen enkele provider is ingesteld", () => {
    const status = buildLlmStatus(null);

    expect(status.level).toBe("NOT_CONFIGURED");
    expect(status.detail).toContain("ANTHROPIC_API_KEY");
  });
});

describe("buildFirestoreStatus", () => {
  it("accepteert zowel de sleutel als het bestandspad als geldige configuratie", () => {
    expect(buildFirestoreStatus(env({ FIREBASE_SERVICE_ACCOUNT_KEY: "{...}" })).level).toBe("OK");
    expect(buildFirestoreStatus(env({ FIREBASE_SERVICE_ACCOUNT_FILE: "./sa.json" })).level).toBe(
      "OK",
    );
  });

  it("ziet een lege of alleen-spaties waarde niet aan voor configuratie", () => {
    expect(buildFirestoreStatus(env({ FIREBASE_SERVICE_ACCOUNT_KEY: "   " })).level).toBe(
      "NOT_CONFIGURED",
    );
    expect(buildFirestoreStatus(env({})).level).toBe("NOT_CONFIGURED");
  });
});

describe("findMissingGithubAppEnvVars", () => {
  it("noemt precies de instellingen die ontbreken", () => {
    const missing = findMissingGithubAppEnvVars(env({ GITHUB_APP_ID: "123" }));

    expect(missing).toEqual(["GITHUB_APP_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY"]);
  });

  it("geeft een lege lijst wanneer alles gezet is", () => {
    const missing = findMissingGithubAppEnvVars(
      env({
        GITHUB_APP_ID: "123",
        GITHUB_APP_INSTALLATION_ID: "456",
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN...",
      }),
    );

    expect(missing).toEqual([]);
  });
});

describe("buildGithubStatus", () => {
  const configured = env({
    GITHUB_APP_ID: "123",
    GITHUB_APP_INSTALLATION_ID: "456",
    GITHUB_APP_PRIVATE_KEY: "-----BEGIN...",
  });

  it("doet geen aanroep wanneer de configuratie nog incompleet is", async () => {
    const check = vi.fn();

    const status = await buildGithubStatus(env({}), check);

    expect(status.level).toBe("NOT_CONFIGURED");
    expect(status.checkedVia).toBe("configuratie");
    expect(check).not.toHaveBeenCalled();
  });

  it("meldt pas OK na een geslaagde ECHTE aanroep, en markeert die als live", async () => {
    const status = await buildGithubStatus(configured, async () =>
      "The-Dost-Matrix/the-dost-matrix (main)",
    );

    expect(status.level).toBe("OK");
    expect(status.checkedVia).toBe("live");
    expect(status.detail).toContain("the-dost-matrix");
  });

  it("meldt ERROR met de echte foutmelding wanneer de aanroep mislukt", async () => {
    const status = await buildGithubStatus(configured, async () => {
      throw new Error("Bad credentials");
    });

    expect(status.level).toBe("ERROR");
    expect(status.detail).toBe("Bad credentials");
    expect(status.checkedVia).toBe("live");
  });
});

describe("summarizeStatusLevel", () => {
  const component = (level: SystemComponentStatus["level"]): SystemComponentStatus => ({
    id: "llm",
    label: "Test",
    level,
    detail: "",
    checkedVia: "configuratie",
  });

  it("laat een echte fout zwaarder wegen dan ontbrekende configuratie", () => {
    expect(summarizeStatusLevel([component("NOT_CONFIGURED"), component("ERROR")])).toBe("ERROR");
  });

  it("meldt NOT_CONFIGURED wanneer er niets kapot is maar wel iets ontbreekt", () => {
    expect(summarizeStatusLevel([component("OK"), component("NOT_CONFIGURED")])).toBe(
      "NOT_CONFIGURED",
    );
  });

  it("meldt alleen OK wanneer werkelijk alles OK is", () => {
    expect(summarizeStatusLevel([component("OK"), component("OK")])).toBe("OK");
  });
});
