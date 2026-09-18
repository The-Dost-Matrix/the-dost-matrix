import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

/**
 * Isolatiepatroon uit src/core/repositories/knowledge-repository.test.ts:
 * mock zowel firebase-admin/firestore als de Firebase Admin-module voordat
 * retrieval.ts wordt geladen. Vitest hoist deze mocks vóór de imports.
 * Er wordt geen echte Firebase-initialisatie of providercall uitgevoerd.
 */
const serverTimestamp = Symbol("serverTimestamp");

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => serverTimestamp,
  },
}));

vi.mock("@/core/firebase/admin", () => ({
  adminDb: {
    collection: vi.fn(() => {
      throw new Error("Retrieval-unit-tests mogen geen database aanroepen.");
    }),
  },
}));

import { adminDb } from "@/core/firebase/admin";
import { findRelevantKnowledge } from "./retrieval";

/** Alle verplichte KnowledgeEntry-velden, zonder typecasts of externe data. */
function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "knowledge-1",
    ownerId: "owner-1",
    type: "fact",
    title: "Kennis zoeken",
    summary: "Kennis zoeken met trefwoorden.",
    content: "Kennis zoeken met trefwoorden.",
    lifecycle: "temporary",
    source: "manual",
    sourceReferences: [],
    status: "approved",
    tags: ["kennis", "zoeken"],
    embedding: [],
    createdAt: new Date("2025-01-15T10:00:00.000Z"),
    ...overrides,
  };
}

describe("findRelevantKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    expect(adminDb.collection).toHaveBeenCalledTimes(0);
  });

  it("sluit pending, rejected, archived en ontbrekende goedkeuring uit", () => {
    const approved = makeEntry({
      id: "approved",
      title: "Kennis zoeken goedgekeurd",
    });
    const entries: KnowledgeEntry[] = [
      makeEntry({
        id: "pending",
        title: "Kennis zoeken concept",
        status: "pending",
      }),
      makeEntry({
        id: "rejected",
        title: "Kennis zoeken afgewezen",
        status: "rejected",
      }),
      makeEntry({
        id: "archived",
        title: "Kennis zoeken archief",
        status: "archived",
      }),
      makeEntry({
        id: "without-status",
        title: "Kennis zoeken zonder status",
        status: undefined,
      }),
      approved,
    ];

    // Elk item is relevant en heeft een eigen deduplicatiesleutel.
    // Zonder statusfilter zouden ze dus alle vijf worden teruggegeven.
    const approvedCandidates: KnowledgeEntry[] = entries.map((entry) => ({
      ...entry,
      status: "approved",
    }));

    expect(
      findRelevantKnowledge("kennis zoeken", null, approvedCandidates),
    ).toHaveLength(5);

    expect(findRelevantKnowledge("kennis zoeken", null, entries)).toEqual([
      approved,
    ]);
  });

  it("geeft een lege lijst voor een uitsluitend uit witruimte bestaande zoekvraag", () => {
    const entry = makeEntry();

    expect(findRelevantKnowledge("kennis zoeken", null, [entry])).toEqual([
      entry,
    ]);
    expect(findRelevantKnowledge(" \t\n\r  ", null, [entry])).toEqual([]);
  });

  it("dedupliceert twee bijna-identieke, relevante items tot precies één resultaat", () => {
    const first = makeEntry({ id: "original" });
    const duplicate = makeEntry({
      id: "duplicate",
      title: "KENNIS   ZOEKEN",
      content: "Kénnis zoeken met trefwoorden!",
    });

    // Beide kandidaten moeten zelfstandig de relevantiefilter passeren.
    expect(findRelevantKnowledge("kennis zoeken", null, [first])).toEqual([
      first,
    ]);
    expect(findRelevantKnowledge("kennis zoeken", null, [duplicate])).toEqual([
      duplicate,
    ]);

    const results = findRelevantKnowledge("kennis zoeken", null, [
      first,
      duplicate,
    ]);

    expect(results).toHaveLength(1);
    expect(results).toEqual([first]);
  });

  it("respecteert een expliciet maximum en kiest de hoogst scorende kandidaten", () => {
    const strongest = makeEntry({
      id: "strongest",
      content: "Kennis zoeken",
    });
    const middle = makeEntry({
      id: "middle",
      content: "Kennis zoeken documenten",
    });
    const weakest = makeEntry({
      id: "weakest",
      content: "Kennis zoeken documenten archieven",
    });
    const entries = [weakest, middle, strongest];

    // Verschillende inhoud voorkomt deduplicatie. Alle drie zijn relevant;
    // minder extra inhoudstokens geeft hier een hogere trefwoordscore.
    const allResults = findRelevantKnowledge("kennis zoeken", null, entries, 3);

    expect(allResults).toHaveLength(3);
    expect(allResults).toEqual([strongest, middle, weakest]);

    const limitedResults = findRelevantKnowledge(
      "kennis zoeken",
      null,
      entries,
      2,
    );

    expect(limitedResults).toHaveLength(2);
    expect(limitedResults).toEqual([strongest, middle]);
  });

  it("sluit goedgekeurde items met lege of uitsluitend witte inhoud uit", () => {
    const valid = makeEntry({ id: "valid" });
    const empty = makeEntry({ id: "empty", content: "" });
    const whitespace = makeEntry({
      id: "whitespace",
      content: " \t\n ",
    });

    expect(
      findRelevantKnowledge("kennis zoeken", null, [empty, whitespace, valid]),
    ).toEqual([valid]);
  });

  it("filtert een item zonder overeenkomst en zonder lifecycle- of typeboost uit", () => {
    // fact en temporary leveren geen boost: zonder tekstovereenkomst is
    // de score 0, onder de drempel van 0.08 in retrieval.ts.
    expect(
      findRelevantKnowledge("sterrenstelsels", null, [makeEntry()]),
    ).toEqual([]);
  });
});
