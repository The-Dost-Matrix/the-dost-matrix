import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regressietests bij de code-audit van 13 september 2026. Ze dekken drie
 * gedragingen die tot die datum stil fout gingen:
 *
 * 1. `createKnowledgeEntry` gaf bij een duplicaat alleen het bestaande id
 *    terug en gooide de nieuwe bronverwijzing weg. Twee onafhankelijke
 *    documenten die dezelfde claim onderbouwen zagen er daardoor uit als één
 *    bron — bewijskracht die verdween zonder spoor.
 * 2. Dezelfde functie maakte voor de aanroeper niet zichtbaar óf er iets
 *    nieuws was ontstaan, waardoor de importroute duplicaten meetelde als
 *    nieuw geïmporteerde kennis.
 * 3. `updateKnowledgeEntry` schreef gewijzigde tekst weg zonder fingerprint
 *    en embedding te verversen, waarna deduplicatie en semantische retrieval
 *    op tekst bleven werken die er niet meer stond.
 */
const serverTimestamp = Symbol("serverTimestamp");

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => serverTimestamp,
  },
}));

vi.mock("@/core/firebase/admin", () => ({
  adminDb: {
    collection: vi.fn(),
  },
}));

import {
  createKnowledgeEntry,
  mergeSourceReference,
  readStoredSourceReferences,
  updateKnowledgeEntry,
} from "./knowledge-repository";
import { adminDb } from "@/core/firebase/admin";

const mockedCollection = vi.mocked(adminDb.collection);

/** Wat de laatste .add()-aanroep naar Firestore zou schrijven. */
let addedDocument: Record<string, unknown> | null = null;
/** Wat de laatste .update()-aanroep naar Firestore zou schrijven. */
let updatedDocument: Record<string, unknown> | null = null;

interface FakeDoc {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Bouwt een minimale, chainable Firestore-dubbel die exact de aanroepen
 * ondersteunt die knowledge-repository.ts doet: where().where().limit().get()
 * voor de duplicaatzoekopdracht, add() voor nieuwe items en doc().get()/
 * update() voor bestaande.
 */
function setupFirestore(options: {
  duplicate?: FakeDoc | null;
  existing?: FakeDoc | null;
}) {
  const duplicate = options.duplicate ?? null;
  const existing = options.existing ?? null;

  const duplicateSnapshot = {
    empty: !duplicate,
    docs: duplicate
      ? [
          {
            id: duplicate.id,
            data: () => duplicate.data,
            ref: {
              update: vi.fn(async (payload: Record<string, unknown>) => {
                updatedDocument = payload;
              }),
            },
          },
        ]
      : [],
  };

  const query = {
    where: vi.fn(() => query),
    limit: vi.fn(() => query),
    get: vi.fn(async () => duplicateSnapshot),
  };

  const docRef = {
    get: vi.fn(async () => ({
      exists: Boolean(existing),
      data: () => existing?.data,
    })),
    update: vi.fn(async (payload: Record<string, unknown>) => {
      updatedDocument = payload;
    }),
  };

  mockedCollection.mockReturnValue({
    where: query.where,
    limit: query.limit,
    get: query.get,
    doc: vi.fn(() => docRef),
    add: vi.fn(async (payload: Record<string, unknown>) => {
      addedDocument = payload;
      return { id: "nieuw-item" };
    }),
  } as never);

  return { duplicateSnapshot, docRef };
}

beforeEach(() => {
  vi.clearAllMocks();
  addedDocument = null;
  updatedDocument = null;
});

describe("readStoredSourceReferences", () => {
  it("leest de meervoudige lijst wanneer die bestaat", () => {
    expect(
      readStoredSourceReferences({
        sourceReferences: [{ filename: "a.md" }, { filename: "b.md" }],
      }),
    ).toEqual([{ filename: "a.md" }, { filename: "b.md" }]);
  });

  it("valt terug op het oude enkelvoudige veld, zodat bestaande items geen migratie nodig hebben", () => {
    expect(
      readStoredSourceReferences({
        sourceReference: { filename: "oud.md", section: "Inleiding" },
      }),
    ).toEqual([{ filename: "oud.md", section: "Inleiding" }]);
  });

  it("geeft een lege lijst wanneer er geen bruikbare bron in staat", () => {
    expect(readStoredSourceReferences({ sourceReference: {} })).toEqual([]);
    expect(readStoredSourceReferences(undefined)).toEqual([]);
  });
});

describe("mergeSourceReference", () => {
  it("voegt een onbekende bron toe en meldt dat er iets veranderd is", () => {
    const result = mergeSourceReference([{ filename: "a.md" }], {
      filename: "b.md",
    });

    expect(result.changed).toBe(true);
    expect(result.references).toEqual([
      { filename: "a.md" },
      { filename: "b.md" },
    ]);
  });

  it("voegt een al bekende bron niet nog een keer toe", () => {
    const result = mergeSourceReference([{ filename: "a.md" }], {
      filename: "a.md",
    });

    expect(result.changed).toBe(false);
    expect(result.references).toHaveLength(1);
  });
});

describe("createKnowledgeEntry", () => {
  it("maakt een nieuw item aan en meldt dat expliciet als nieuw", async () => {
    setupFirestore({ duplicate: null });

    const result = await createKnowledgeEntry({
      ownerId: "owner-1",
      content: "De Director mag pas mergen als CI groen is.",
      title: "Merge-regel",
      source: "document",
      sourceReference: { filename: "besluiten.md" },
    });

    expect(result).toEqual({
      id: "nieuw-item",
      created: true,
      evidenceAdded: false,
    });

    expect(addedDocument?.sourceReferences).toEqual([
      { filename: "besluiten.md" },
    ]);
  });

  it("voegt bij een duplicaat de tweede bron toe in plaats van hem weg te gooien", async () => {
    setupFirestore({
      duplicate: {
        id: "bestaand-item",
        data: {
          ownerId: "owner-1",
          sourceReference: { filename: "eerste-bron.md" },
        },
      },
    });

    const result = await createKnowledgeEntry({
      ownerId: "owner-1",
      content: "De Director mag pas mergen als CI groen is.",
      title: "Merge-regel",
      source: "document",
      sourceReference: { filename: "tweede-bron.md" },
    });

    expect(result).toEqual({
      id: "bestaand-item",
      created: false,
      evidenceAdded: true,
    });

    expect(updatedDocument?.sourceReferences).toEqual([
      { filename: "eerste-bron.md" },
      { filename: "tweede-bron.md" },
    ]);
  });

  it("schrijft niets wanneer dezelfde bron hetzelfde item opnieuw aanbiedt", async () => {
    setupFirestore({
      duplicate: {
        id: "bestaand-item",
        data: {
          ownerId: "owner-1",
          sourceReferences: [{ filename: "eerste-bron.md" }],
        },
      },
    });

    const result = await createKnowledgeEntry({
      ownerId: "owner-1",
      content: "De Director mag pas mergen als CI groen is.",
      title: "Merge-regel",
      source: "document",
      sourceReference: { filename: "eerste-bron.md" },
    });

    expect(result.created).toBe(false);
    expect(result.evidenceAdded).toBe(false);
    expect(updatedDocument).toBeNull();
  });
});

describe("updateKnowledgeEntry", () => {
  const existingEntry = {
    id: "item-1",
    data: {
      ownerId: "owner-1",
      type: "decision",
      title: "Merge-regel",
      content: "De Director mag pas mergen als CI groen is.",
      embedding: [0.1, 0.2, 0.3],
    },
  };

  it("herberekent de fingerprint zodra de inhoud wijzigt", async () => {
    setupFirestore({ existing: existingEntry });

    await updateKnowledgeEntry("owner-1", "item-1", {
      content: "De Director mag pas mergen als CI groen is én QA akkoord is.",
    });

    expect(typeof updatedDocument?.fingerprint).toBe("string");
    expect(updatedDocument?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("wist een verouderde embedding wanneer de aanroeper geen verse meelevert", async () => {
    setupFirestore({ existing: existingEntry });

    await updateKnowledgeEntry("owner-1", "item-1", {
      content: "Volledig andere tekst dan hiervoor.",
    });

    expect(updatedDocument?.embedding).toEqual([]);
  });

  it("bewaart de meegeleverde verse embedding", async () => {
    setupFirestore({ existing: existingEntry });

    await updateKnowledgeEntry("owner-1", "item-1", {
      content: "Volledig andere tekst dan hiervoor.",
      embedding: [0.9, 0.8],
    });

    expect(updatedDocument?.embedding).toEqual([0.9, 0.8]);
  });

  it("laat fingerprint en embedding met rust bij een wijziging die de tekst niet raakt", async () => {
    setupFirestore({ existing: existingEntry });

    await updateKnowledgeEntry("owner-1", "item-1", {
      summary: "Een nieuwe samenvatting.",
      tags: ["merge", "ci"],
    });

    expect(updatedDocument).not.toHaveProperty("fingerprint");
    expect(updatedDocument).not.toHaveProperty("embedding");
  });

  it("geeft dezelfde fingerprint als een nieuw item met exact die tekst", async () => {
    // Round-trip: dit is de eigenschap waar deduplicatie op leunt. Zou een
    // bewerking een ándere fingerprint opleveren dan een nieuwe aanmaak met
    // dezelfde tekst, dan herkent het systeem echte duplicaten niet meer.
    setupFirestore({ duplicate: null });

    await createKnowledgeEntry({
      ownerId: "owner-1",
      type: "decision",
      title: "Nieuwe titel",
      content: "Nieuwe inhoud.",
      source: "document",
    });

    const fingerprintBijAanmaak = addedDocument?.fingerprint;

    setupFirestore({ existing: existingEntry });

    await updateKnowledgeEntry("owner-1", "item-1", {
      title: "Nieuwe titel",
      content: "Nieuwe inhoud.",
    });

    expect(updatedDocument?.fingerprint).toBe(fingerprintBijAanmaak);
  });

  it("weigert een item van een andere eigenaar", async () => {
    setupFirestore({
      existing: {
        id: "item-1",
        data: { ownerId: "iemand-anders", content: "x" },
      },
    });

    await expect(
      updateKnowledgeEntry("owner-1", "item-1", { content: "y" }),
    ).rejects.toThrow("Kennisitem niet gevonden.");
  });
});
