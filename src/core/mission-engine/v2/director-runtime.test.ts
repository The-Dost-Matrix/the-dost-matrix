import { describe, expect, it, vi } from "vitest";

/**
 * `director-runtime.ts` importeert (indirect, via kennis-ophalen voor de
 * Director) `@/core/firebase/admin`, dat op moduleniveau meteen de Firebase
 * Admin SDK initialiseert (`export const adminAuth = getAuth(getAdminApp())`).
 * Zonder deze mock crasht elke test die dit bestand importeert al bij het
 * laden van de module, buiten deze tests om, met "FIREBASE_SERVICE_ACCOUNT_KEY
 * en FIREBASE_SERVICE_ACCOUNT_FILE ontbreken" — ook al gebruiken de tests
 * hieronder zelf geen Firebase. Vitest hoist't vi.mock-aanroepen automatisch
 * naar de top van het bestand, dus de plek hier (vóór de echte import) is
 * puur voor de leesbaarheid.
 */
vi.mock("@/core/firebase/admin", () => ({
  adminAuth: {},
  adminDb: {},
  verifyIdToken: vi.fn(),
}));

import { DirectorRuntimeError, type DirectorRuntimeErrorCode } from "./director-runtime";

/**
 * Tests voor `DirectorRuntimeError` (Stap 5: gestructureerde foutcodes i.p.v.
 * string-matching).
 *
 * Bewust beperkt tot de foutklasse zelf, zonder `ensureMissionPullRequestMerged`
 * aan te roepen: die functie praat rechtstreeks met meerdere GitHub-API-
 * functies (PR's ophalen, CI-status, bestanden, mergen) en heeft geen
 * dependency-injection, dus die end-to-end testen vereist het mocken van de
 * hele module — dat wordt al gedekt door route.test.ts, dat aantoont dat een
 * DirectorRuntimeError met code "NEEDS_SIGNOFF" daadwerkelijk als
 * `code: "NEEDS_SIGNOFF"` in de JSON-foutrespons van de API-route terechtkomt.
 * Deze tests bewijzen het andere, ontbrekende stuk: dat de foutklasse zelf
 * zich correct gedraagt, onafhankelijk van waar hij vandaan gegooid wordt.
 */
describe("DirectorRuntimeError", () => {
  it("is een gewone Error met een machineleesbaar code-veld", () => {
    const error = new DirectorRuntimeError(
      "NEEDS_SIGNOFF",
      "Pull request #42 vereist eigen goedkeuring voordat de Director hem mag mergen.",
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DirectorRuntimeError);
    expect(error.name).toBe("DirectorRuntimeError");
    expect(error.code).toBe("NEEDS_SIGNOFF");
    expect(error.message).toBe(
      "Pull request #42 vereist eigen goedkeuring voordat de Director hem mag mergen.",
    );
  });

  it("blijft herkenbaar als gewone Error voor generieke foutafhandeling (bijv. logging)", () => {
    const error = new DirectorRuntimeError("MERGE_FAILED", "Mergen is mislukt.");

    expect(typeof error.message).toBe("string");
    expect(typeof error.stack).toBe("string");
  });

  it("ondersteunt elk van de gedefinieerde foutcodes zonder de mens-leesbare boodschap te beperken", () => {
    const codes: DirectorRuntimeErrorCode[] = [
      "NEEDS_SIGNOFF",
      "CI_CHECKS_FAILED",
      "CI_CHECKS_PENDING",
      "MERGE_FAILED",
      "PULL_REQUEST_NOT_FOUND",
      "CRITERIA_NOT_PASSED",
      "TECHNICAL_REPAIR_EXHAUSTED",
    ];

    for (const code of codes) {
      const error = new DirectorRuntimeError(code, `Voorbeeldmelding voor ${code}`);
      expect(error.code).toBe(code);
    }
  });

  it("blijft NEEDS_SIGNOFF teruggeven ongeacht de bewoording van de mens-leesbare boodschap", () => {
    const error = new DirectorRuntimeError(
      "NEEDS_SIGNOFF",
      "Deze tekst bevat bewust geen letterlijke marker meer — de bewoording mag vrij wijzigen.",
    );

    expect(error.code).toBe("NEEDS_SIGNOFF");
  });
});
