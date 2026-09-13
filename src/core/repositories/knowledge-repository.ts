import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/core/firebase/admin";

import type {
  KnowledgeEntry,
  KnowledgeLifecycle,
  KnowledgeReview,
  KnowledgeReviewRecommendation,
  KnowledgeSource,
  KnowledgeSourceReference,
  KnowledgeStatus,
  KnowledgeType,
} from "@/core/domain/knowledge/knowledge-entry";

const COLLECTION = "knowledge";

export interface CreateKnowledgeEntryInput {
  ownerId: string;

  type?: KnowledgeType;
  title?: string;
  summary?: string;
  content: string;
  project?: string;
  lifecycle?: KnowledgeLifecycle;

  source: KnowledgeSource;
  sourceDocument?: string;
  sourceSection?: string;
  sourceReference?: {
    documentId?: string;
    filename?: string;
    section?: string;
    chunkIndex?: number;
  };

  status?: KnowledgeStatus;
  confidence?: number;

  tags?: string[];
  embedding?: number[];
}

function createFingerprint(
  type: KnowledgeType | undefined,
  title: string | undefined,
  content: string,
): string {
  return createHash("sha256")
    .update(
      [
        type ?? "fact",
        title?.trim().toLowerCase() ?? "",
        content.trim().toLowerCase(),
      ].join("\n"),
    )
    .digest("hex");
}

/**
 * Maakt van een losse bronverwijzing een vergelijkbare, opslagbare vorm:
 * lege strings en ontbrekende velden verdwijnen, zodat `{ filename: "a.md" }`
 * en `{ filename: "a.md", section: "" }` als dezelfde bron gelden en niet als
 * twee. Geeft null terug wanneer er niets bruikbaars overblijft — een lege
 * bronverwijzing is geen bewijs en hoort niet in de lijst.
 */
function normalizeSourceReference(
  reference: unknown,
): KnowledgeSourceReference | null {
  if (!reference || typeof reference !== "object") {
    return null;
  }

  const candidate = reference as Record<string, unknown>;
  const normalized: KnowledgeSourceReference = {};

  if (typeof candidate.documentId === "string" && candidate.documentId.trim()) {
    normalized.documentId = candidate.documentId.trim();
  }

  if (typeof candidate.filename === "string" && candidate.filename.trim()) {
    normalized.filename = candidate.filename.trim();
  }

  if (typeof candidate.section === "string" && candidate.section.trim()) {
    normalized.section = candidate.section.trim();
  }

  if (
    typeof candidate.chunkIndex === "number" &&
    Number.isFinite(candidate.chunkIndex)
  ) {
    normalized.chunkIndex = candidate.chunkIndex;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function isSameSourceReference(
  first: KnowledgeSourceReference,
  second: KnowledgeSourceReference,
): boolean {
  return (
    first.documentId === second.documentId &&
    first.filename === second.filename &&
    first.section === second.section &&
    first.chunkIndex === second.chunkIndex
  );
}

/**
 * Leest de bronnenlijst van een opgeslagen kennisitem, met terugval op het
 * oude enkelvoudige `sourceReference`-veld. Daardoor hoeven bestaande
 * Firestore-documenten niet gemigreerd te worden: ze gedragen zich als een
 * lijst van één, en krijgen hun tweede bron er gewoon bij zodra die zich
 * aandient.
 */
export function readStoredSourceReferences(
  data: Record<string, unknown> | undefined,
): KnowledgeSourceReference[] {
  const stored = data?.sourceReferences;

  if (Array.isArray(stored)) {
    const references = stored
      .map(normalizeSourceReference)
      .filter((reference): reference is KnowledgeSourceReference =>
        Boolean(reference),
      );

    if (references.length > 0) {
      return references;
    }
  }

  const legacy = normalizeSourceReference(data?.sourceReference);

  return legacy ? [legacy] : [];
}

/**
 * Voegt een bron toe aan een bestaande bronnenlijst, tenzij hij er al in
 * staat. Geeft expliciet terug of er iets veranderd is, zodat de aanroeper
 * een overbodige Firestore-schrijfactie kan overslaan én eerlijk kan
 * rapporteren of een duplicaat daadwerkelijk bewijs heeft toegevoegd.
 */
export function mergeSourceReference(
  existing: KnowledgeSourceReference[],
  incoming: KnowledgeSourceReference | null,
): { references: KnowledgeSourceReference[]; changed: boolean } {
  if (!incoming) {
    return { references: existing, changed: false };
  }

  const alreadyPresent = existing.some((reference) =>
    isSameSourceReference(reference, incoming),
  );

  if (alreadyPresent) {
    return { references: existing, changed: false };
  }

  return { references: [...existing, incoming], changed: true };
}

function isReviewRecommendation(
  value: unknown,
): value is KnowledgeReviewRecommendation {
  return value === "approve" || value === "edit" || value === "reject";
}

function isKnowledgeLifecycle(
  value: unknown,
): value is KnowledgeLifecycle {
  return (
    value === "foundation" ||
    value === "project" ||
    value === "working" ||
    value === "temporary"
  );
}

/**
 * Uitkomst van een poging tot opslaan. Vóór de code-audit van 13 september
 * 2026 gaf deze functie alleen een id terug, waardoor de aanroeper niet kon
 * zien of er werkelijk iets nieuws was ontstaan: de importroute telde elk
 * teruggegeven id als "geïmporteerd", ook wanneer het om een bestaand item
 * ging. Het scherm meldde dan bijvoorbeeld acht nieuwe kennisitems terwijl er
 * nul waren bijgekomen. Deze drie velden maken dat verschil expliciet.
 */
export interface CreateKnowledgeEntryResult {
  id: string;
  /** true wanneer er een nieuw document is aangemaakt. */
  created: boolean;
  /** true wanneer een bestaand item er een nieuwe bronverwijzing bij kreeg. */
  evidenceAdded: boolean;
}

export async function createKnowledgeEntry(
  input: CreateKnowledgeEntryInput,
): Promise<CreateKnowledgeEntryResult> {
  const fingerprint = createFingerprint(
    input.type,
    input.title,
    input.content,
  );

  const incomingReference = normalizeSourceReference(input.sourceReference);

  const duplicate = await adminDb
    .collection(COLLECTION)
    .where("ownerId", "==", input.ownerId)
    .where("fingerprint", "==", fingerprint)
    .limit(1)
    .get();

  if (!duplicate.empty) {
    const existing = duplicate.docs[0];

    // Een duplicaat is geen reden om niets te doen: dezelfde claim uit een
    // TWEEDE bron maakt die claim sterker, niet overbodig. De inhoud blijft
    // ongemoeid (die is per definitie identiek — daar komt de fingerprint
    // vandaan), maar de nieuwe bron wordt aan de bewijslijst toegevoegd.
    const merged = mergeSourceReference(
      readStoredSourceReferences(existing.data()),
      incomingReference,
    );

    if (merged.changed) {
      await existing.ref.update({
        sourceReferences: merged.references,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return {
      id: existing.id,
      created: false,
      evidenceAdded: merged.changed,
    };
  }

  const now = FieldValue.serverTimestamp();

  const doc = await adminDb.collection(COLLECTION).add({
    ownerId: input.ownerId,

    type: input.type ?? "fact",
    title: input.title?.trim() ?? "",
    summary: input.summary?.trim() ?? "",
    content: input.content.trim(),
    project: input.project?.trim() ?? "",
    lifecycle: input.lifecycle ?? "foundation",

    source: input.source,
    sourceDocument:
      input.sourceDocument ?? input.sourceReference?.filename ?? "",
    sourceSection:
      input.sourceSection ?? input.sourceReference?.section ?? "",
    sourceReference: input.sourceReference ?? {},
    // Blijft naast het oude enkelvoudige veld staan: bestaande lezers (en
    // eventuele handmatige Firestore-inspectie) blijven werken, terwijl
    // nieuwe items meteen de meervoudige vorm hebben.
    sourceReferences: incomingReference ? [incomingReference] : [],

    status: input.status ?? "pending",
    confidence: Math.max(0, Math.min(1, input.confidence ?? 0.8)),

    tags: input.tags ?? [],
    embedding: input.embedding ?? [],
    fingerprint,

    createdAt: now,
    updatedAt: now,
    approvedAt: input.status === "approved" ? now : null,
  });

  return { id: doc.id, created: true, evidenceAdded: false };
}

function mapEntry(
  doc: FirebaseFirestore.DocumentSnapshot,
): KnowledgeEntry {
  const data = doc.data();

  if (!data) {
    throw new Error("Kennisitem kon niet worden gelezen.");
  }

  const storedReview = data.review;

  const review: KnowledgeReview | undefined =
    storedReview &&
    typeof storedReview === "object" &&
    isReviewRecommendation(storedReview.recommendation)
      ? {
          recommendation: storedReview.recommendation,
          confidence:
            typeof storedReview.confidence === "number"
              ? storedReview.confidence
              : 0,
          reason:
            typeof storedReview.reason === "string"
              ? storedReview.reason
              : "",
          issues: Array.isArray(storedReview.issues)
            ? storedReview.issues.filter(
                (issue: unknown): issue is string =>
                  typeof issue === "string",
              )
            : [],
          suggestedTitle:
            typeof storedReview.suggestedTitle === "string"
              ? storedReview.suggestedTitle
              : undefined,
          suggestedContent:
            typeof storedReview.suggestedContent === "string"
              ? storedReview.suggestedContent
              : undefined,
          reviewedAt: storedReview.reviewedAt?.toDate?.() ?? null,
          model:
            typeof storedReview.model === "string"
              ? storedReview.model
              : "",
        }
      : undefined;

  return {
    id: doc.id,
    ownerId: data.ownerId as string,

    type: data.type as KnowledgeType | undefined,
    title: typeof data.title === "string" ? data.title : undefined,
    summary: typeof data.summary === "string" ? data.summary : undefined,
    content: typeof data.content === "string" ? data.content : "",
    project: typeof data.project === "string" ? data.project : undefined,
    lifecycle: isKnowledgeLifecycle(data.lifecycle)
      ? data.lifecycle
      : undefined,

    source: data.source as KnowledgeSource,
    sourceDocument:
      typeof data.sourceDocument === "string"
        ? data.sourceDocument
        : data.sourceReference?.filename,
    sourceSection:
      typeof data.sourceSection === "string"
        ? data.sourceSection
        : data.sourceReference?.section,

    sourceReferences: readStoredSourceReferences(data),

    status: data.status as KnowledgeStatus | undefined,
    confidence:
      typeof data.confidence === "number" ? data.confidence : undefined,

    tags: Array.isArray(data.tags)
      ? data.tags.filter(
          (tag: unknown): tag is string => typeof tag === "string",
        )
      : [],

    embedding: Array.isArray(data.embedding)
      ? data.embedding.filter(
          (value: unknown): value is number => typeof value === "number",
        )
      : [],

    createdAt: data.createdAt?.toDate?.() ?? null,
    updatedAt: data.updatedAt?.toDate?.() ?? null,
    approvedAt: data.approvedAt?.toDate?.() ?? null,
    review,
  };
}

export async function getKnowledgeEntries(
  ownerId: string,
  limit = 500,
): Promise<KnowledgeEntry[]> {
  const snapshot = await adminDb
    .collection(COLLECTION)
    .where("ownerId", "==", ownerId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map(mapEntry);
}

export async function getKnowledgeEntryById(
  ownerId: string,
  id: string,
): Promise<KnowledgeEntry> {
  const snapshot = await adminDb.collection(COLLECTION).doc(id).get();

  if (!snapshot.exists || snapshot.data()?.ownerId !== ownerId) {
    throw new Error("Kennisitem niet gevonden.");
  }

  return mapEntry(snapshot);
}

export async function updateKnowledgeStatus(
  ownerId: string,
  id: string,
  status: KnowledgeStatus,
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const snapshot = await ref.get();

  if (!snapshot.exists || snapshot.data()?.ownerId !== ownerId) {
    throw new Error("Kennisitem niet gevonden.");
  }

  await ref.update({
    status,
    updatedAt: FieldValue.serverTimestamp(),
    approvedAt:
      status === "approved"
        ? FieldValue.serverTimestamp()
        : null,
  });
}

export interface UpdateKnowledgeEntryInput {
  title?: string;
  summary?: string;
  content?: string;
  project?: string;
  lifecycle?: KnowledgeLifecycle;
  type?: KnowledgeType;
  confidence?: number;
  tags?: string[];
  /**
   * Verse embedding die hoort bij de nieuwe tekst. Alleen meegeven wanneer
   * title of content wijzigt; laat weg wanneer er geen embedding-provider
   * beschikbaar is (zie de toelichting hieronder over wat er dan gebeurt).
   */
  embedding?: number[];
}

/**
 * Werkt een kennisitem bij en houdt daarbij fingerprint en embedding in stap
 * met de tekst.
 *
 * Waarom dit niet langer een simpele doorgeefluik-update is (code-audit van
 * 13 september 2026): deze functie schreef `...updates` rechtstreeks naar
 * Firestore. Wijzigde de eigenaar via het beoordelingsscherm de inhoud van
 * een kennisitem, dan bleven `fingerprint` en `embedding` van de OUDE tekst
 * staan. Twee stille gevolgen: deduplicatie vergeleek daarna nog steeds op de
 * oude tekst (een echt duplicaat werd niet meer herkend, een niet-duplicaat
 * juist wel), en semantische retrieval haalde het item op grond van tekst die
 * er niet meer stond — het item kwam dus boven bij de verkeerde vragen en
 * bleef weg bij de juiste.
 *
 * De fingerprint wordt hier zelf herberekend: dat is een pure hashfunctie
 * zonder netwerkaanroep, dus die hoort thuis op de plek die de opslag doet.
 * De embedding NIET: die vereist een providercall, en een repository die zelf
 * een LLM-provider aanroept doorbreekt de laagscheiding die de rest van dit
 * project aanhoudt. De aanroeper levert hem aan via `updates.embedding`.
 *
 * Levert de aanroeper géén verse embedding terwijl de tekst wel wijzigt, dan
 * wordt de oude embedding gewist in plaats van bewaard. Dat is bewust de
 * veiligste kant: een leeg embedding-veld laat `cosineSimilarity` op 0
 * uitkomen (zie retrieval.ts), waardoor het item alleen nog op trefwoorden
 * meedoet — minder scherp, maar wél over de tekst die er werkelijk staat. Een
 * verouderde embedding laten staan geeft juist zelfverzekerd verkeerde
 * treffers, en dat is in een kennissysteem het duurdere van de twee.
 *
 * Bewust NIET toegevoegd: een duplicaatcontrole op de nieuwe fingerprint. Een
 * bewerking die toevallig samenvalt met een bestaand item zou dan geweigerd
 * of stilzwijgend samengevoegd moeten worden, en beide zijn erger dan het
 * probleem: de eigenaar zit op dat moment in het beoordelingsscherm en krijgt
 * zijn eigen wijziging niet opgeslagen. Dat is een eigen afweging waard, geen
 * bijvangst van deze reparatie.
 */
export async function updateKnowledgeEntry(
  ownerId: string,
  id: string,
  updates: UpdateKnowledgeEntryInput,
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const snapshot = await ref.get();
  const existing = snapshot.data();

  if (!snapshot.exists || existing?.ownerId !== ownerId) {
    throw new Error("Kennisitem niet gevonden.");
  }

  const changesFingerprintInput =
    updates.type !== undefined ||
    updates.title !== undefined ||
    updates.content !== undefined;

  const payload: Record<string, unknown> = {
    ...updates,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (changesFingerprintInput) {
    const nextType = (updates.type ??
      (typeof existing?.type === "string"
        ? (existing.type as KnowledgeType)
        : undefined)) as KnowledgeType | undefined;

    const nextTitle =
      updates.title ??
      (typeof existing?.title === "string" ? existing.title : undefined);

    const nextContent =
      updates.content ??
      (typeof existing?.content === "string" ? existing.content : "");

    payload.fingerprint = createFingerprint(nextType, nextTitle, nextContent);

    const textChanged =
      updates.title !== undefined || updates.content !== undefined;

    if (textChanged && updates.embedding === undefined) {
      payload.embedding = [];
    }
  }

  await ref.update(payload);
}

export async function updateKnowledgeReview(
  ownerId: string,
  id: string,
  review: KnowledgeReview,
): Promise<void> {
  const ref = adminDb.collection(COLLECTION).doc(id);
  const snapshot = await ref.get();

  if (!snapshot.exists || snapshot.data()?.ownerId !== ownerId) {
    throw new Error("Kennisitem niet gevonden.");
  }

  await ref.update({
    review: {
      recommendation: review.recommendation,
      confidence: review.confidence,
      reason: review.reason,
      issues: review.issues,
      suggestedTitle: review.suggestedTitle ?? null,
      suggestedContent: review.suggestedContent ?? null,
      reviewedAt: FieldValue.serverTimestamp(),
      model: review.model,
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
}