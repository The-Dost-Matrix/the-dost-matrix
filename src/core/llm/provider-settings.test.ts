import { describe, expect, it } from "vitest";

import {
  DEFAULT_OWNER_LLM_SETTINGS,
  getActiveLlmSettings,
  isChatProviderPreference,
  normalizeOwnerLlmSettings,
  runWithLlmSettings,
} from "./provider-settings";

describe("normalizeOwnerLlmSettings", () => {
  it("valt terug op 'auto' bij onbekende of ontbrekende invoer", () => {
    // Een onleesbare instelling mag nooit betekenen dat er helemaal geen
    // provider meer gekozen kan worden — dan zou één rommelig Firestore-veld
    // de hele Matrix stilleggen.
    expect(normalizeOwnerLlmSettings(null)).toEqual(DEFAULT_OWNER_LLM_SETTINGS);
    expect(normalizeOwnerLlmSettings({ chatProvider: "gemini" })).toEqual({
      chatProvider: "auto",
    });
    expect(normalizeOwnerLlmSettings("openai")).toEqual({ chatProvider: "auto" });
  });

  it("behoudt een geldige keuze", () => {
    expect(normalizeOwnerLlmSettings({ chatProvider: "openai" })).toEqual({
      chatProvider: "openai",
    });
  });

  it("neemt een modelnaam over en laat lege waarden weg", () => {
    expect(
      normalizeOwnerLlmSettings({ chatProvider: "openai", chatModel: "  gpt-5  " }),
    ).toEqual({ chatProvider: "openai", chatModel: "gpt-5" });

    expect(
      normalizeOwnerLlmSettings({ chatProvider: "openai", chatModel: "   " }),
    ).toEqual({ chatProvider: "openai" });
  });

  it("begrenst een absurd lange modelnaam", () => {
    const result = normalizeOwnerLlmSettings({
      chatProvider: "openai",
      chatModel: "x".repeat(500),
    });

    expect(result.chatModel?.length).toBe(120);
  });
});

describe("isChatProviderPreference", () => {
  it("accepteert alleen de drie bekende waarden", () => {
    expect(isChatProviderPreference("auto")).toBe(true);
    expect(isChatProviderPreference("anthropic")).toBe(true);
    expect(isChatProviderPreference("openai")).toBe(true);
    expect(isChatProviderPreference("claude")).toBe(false);
    expect(isChatProviderPreference(undefined)).toBe(false);
  });
});

describe("runWithLlmSettings", () => {
  it("geeft null terug buiten een wrapper", () => {
    expect(getActiveLlmSettings()).toBeNull();
  });

  it("maakt de instelling zichtbaar tot diep in de aanroepketen", async () => {
    // Dit is waarom deze stap een AsyncLocalStorage gebruikt: geen van de
    // achttien plekken die een provider opvragen hoeft een parameter door te
    // geven, ook niet drie lagen diep.
    async function diepstePunt() {
      return getActiveLlmSettings();
    }

    async function tussenlaag() {
      return diepstePunt();
    }

    const seen = await runWithLlmSettings({ chatProvider: "openai" }, tussenlaag);

    expect(seen).toEqual({ chatProvider: "openai" });
  });

  it("laat niets achter na afloop", async () => {
    await runWithLlmSettings({ chatProvider: "anthropic" }, async () => undefined);

    expect(getActiveLlmSettings()).toBeNull();
  });

  it("houdt twee gelijktijdige aanroepen uit elkaar", async () => {
    // Op Vercel draaien meerdere verzoeken in hetzelfde proces. Zou de keuze
    // in een gewone module-variabele staan, dan zou het ene verzoek de
    // provider van het andere kunnen overschrijven.
    const [eerste, tweede] = await Promise.all([
      runWithLlmSettings({ chatProvider: "openai" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getActiveLlmSettings()?.chatProvider;
      }),
      runWithLlmSettings({ chatProvider: "anthropic" }, async () =>
        getActiveLlmSettings()?.chatProvider,
      ),
    ]);

    expect(eerste).toBe("openai");
    expect(tweede).toBe("anthropic");
  });
});
