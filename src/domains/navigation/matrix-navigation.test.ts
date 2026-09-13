import { describe, expect, it } from "vitest";

import { isActivePath, mainNavigation, plannedNavigation } from "./matrix-navigation";

/**
 * isActivePath stond hiervoor ongetest lokaal in sidebar.tsx. Nu hij
 * gedeeld wordt met topbar-navigation-menu.tsx (de mobiele vervanging van de
 * zijbalk-navigatie, zie de toelichting in dat bestand), is een kleine test
 * hier goedkoop en voorkomt hij dat beide navigatieweergaves ooit stil
 * uiteenlopen in welke link als "actief" geldt.
 */
describe("isActivePath", () => {
  it("markeert Command Center (/dashboard) alleen als exacte match, niet als prefix", () => {
    expect(isActivePath("/dashboard", "/dashboard")).toBe(true);
    expect(isActivePath("/dashboard/missions-v2", "/dashboard")).toBe(false);
  });

  it("markeert overige items als actief zodra het pad ermee begint", () => {
    expect(isActivePath("/dashboard/missions-v2", "/dashboard/missions-v2")).toBe(true);
    expect(isActivePath("/dashboard/missions-v2/123", "/dashboard/missions-v2")).toBe(true);
    expect(isActivePath("/dashboard/knowledge", "/dashboard/missions-v2")).toBe(false);
  });
});

describe("navigatielijsten", () => {
  it("bevatten geen dubbele labels binnen mainNavigation of plannedNavigation", () => {
    const mainLabels = mainNavigation.map((item) => item.label);
    const plannedLabels = plannedNavigation.map((item) => item.label);

    expect(new Set(mainLabels).size).toBe(mainLabels.length);
    expect(new Set(plannedLabels).size).toBe(plannedLabels.length);
  });
});
