import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Minimale vitest-configuratie voor de eerste unit tests in dit project
 * (zie src/core/llm/pricing.test.ts, usage-tracker.test.ts en
 * src/core/mission-engine/v2/risk-classification.test.ts).
 *
 * Spiegelt bewust alleen de "@/*"-padalias uit tsconfig.json (nodig zodra een
 * test, net als de rest van de codebase, via "@/core/..." importeert in
 * plaats van een relatief pad) — verder geen browser/React-testomgeving
 * (jsdom e.d.), omdat de eerste tests pure logica testen, geen componenten.
 * Dat kan later uitgebreid worden zodra er ook componenttests bijkomen.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});
