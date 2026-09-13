import {
  collection,
  limit as limitTo,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QuerySnapshot,
} from "firebase/firestore";

import { db } from "@/core/firebase/client";

import type {
  KnowledgeEntry,
  KnowledgeReviewRecommendation,
  KnowledgeSource,
  KnowledgeSourceReference,
  KnowledgeStatus,
  KnowledgeType,
} from "@/core/domain/knowledge/knowledge-entry";

/**
 * Leest de bronnenlijst van een kennisitem aan de clientkant, met terugval op
 * het oude enkelvoudige `sourceReference`-veld.
 *
 * Bewust een eigen, kleine kopie van `readStoredSourceReferences` uit
 * knowledge-repository.ts in plaats van een gedeelde import: die module leest
 * `firebase-admin` in, en dat pakket hoort niet in een clientbundel terecht te
 * komen. De vorm die beide lezen is hetzelfde en ligt vast in
 * knowledge-entry.ts; verandert die, dan verandert hij hier mee.
 */
function readSourceReferences(data: DocumentData): KnowledgeSourceReference[] {
  const normalize = (value: unknown): KnowledgeSourceReference | null => {
    if (!value || typeof value !== "object") {
      return null;
    }

    const candidate = value as Record<string, unknown>;
    const reference: KnowledgeSourceReference = {};

    if (typeof candidate.documentId === "string" && candidate.documentId.trim()) {
      reference.documentId = candidate.documentId.trim();
    }

    if (typeof candidate.filename === "string" && candidate.filename.trim()) {
      reference.filename = candidate.filename.trim();
    }

    if (typeof candidate.section === "string" && candidate.section.trim()) {
      reference.section = candidate.section.trim();
    }

    if (
      typeof candidate.chunkIndex === "number" &&
      Number.isFinite(candidate.chunkIndex)
    ) {
      reference.chunkIndex = candidate.chunkIndex;
    }

    return Object.keys(reference).length > 0 ? reference : null;
  };

  if (Array.isArray(data.sourceReferences)) {
    const references = data.sourceReferences
      .map(normalize)
      .filter((reference): reference is KnowledgeSourceReference =>
        Boolean(reference),
      );

    if (references.length > 0) {
      return references;
    }
  }

  const legacy = normalize(data.sourceReference);

  return legacy ? [legacy] : [];
}

/** Zet één Firestore-snapshot van de "knowledge"-collectie om naar KnowledgeEntry[]. */
function mapKnowledgeSnapshot(
  snapshot: QuerySnapshot<DocumentData>,
): KnowledgeEntry[] {
  return snapshot.docs.map((document) => {
    const data = document.data();

    return {
      id: document.id,
      ownerId: data.ownerId as string,

      type: data.type as KnowledgeType | undefined,
      title: typeof data.title === "string" ? data.title : undefined,
      summary: typeof data.summary === "string" ? data.summary : undefined,
      content: data.content as string,
      project: typeof data.project === "string" ? data.project : undefined,

      source: data.source as KnowledgeSource,
      sourceDocument:
        typeof data.sourceDocument === "string" ? data.sourceDocument : undefined,
      sourceSection:
        typeof data.sourceSection === "string" ? data.sourceSection : undefined,

      sourceReferences: readSourceReferences(data),

      status: data.status as KnowledgeStatus | undefined,
      confidence: typeof data.confidence === "number" ? data.confidence : undefined,

      tags: (data.tags as string[]) ?? [],
      embedding: [],

      createdAt: data.createdAt?.toDate?.() ?? null,
      updatedAt: data.updatedAt?.toDate?.() ?? null,
      approvedAt: data.approvedAt?.toDate?.() ?? null,
      review:
        data.review &&
        typeof data.review === "object" &&
        (["approve", "edit", "reject"] as const).includes(
          data.review.recommendation as KnowledgeReviewRecommendation,
        )
          ? {
              recommendation: data.review.recommendation as KnowledgeReviewRecommendation,
              confidence:
                typeof data.review.confidence === "number" ? data.review.confidence : 0,
              reason: typeof data.review.reason === "string" ? data.review.reason : "",
              issues: Array.isArray(data.review.issues)
                ? data.review.issues.filter(
                    (issue: unknown): issue is string => typeof issue === "string",
                  )
                : [],
              suggestedTitle:
                typeof data.review.suggestedTitle === "string"
                  ? data.review.suggestedTitle
                  : undefined,
              suggestedContent:
                typeof data.review.suggestedContent === "string"
                  ? data.review.suggestedContent
                  : undefined,
              reviewedAt: data.review.reviewedAt?.toDate?.() ?? null,
              model: typeof data.review.model === "string" ? data.review.model : "",
            }
          : undefined,
    } satisfies KnowledgeEntry;
  });
}

/**
 * Luistert naar de `max` nieuwste kennisitems van een eigenaar, van ALLE
 * statussen door elkaar. Geschikt voor een algemeen overzicht (zoals de
 * goedgekeurde kennis op de kennispagina, of de laatste activiteit in de
 * event stream) — niet voor een wachtrij waarvan geen enkel item onopgemerkt
 * mag verdwijnen, zie `subscribeToKnowledgeByStatus` hieronder.
 */
export function subscribeToKnowledge(
  ownerId: string,
  onChange: (entries: KnowledgeEntry[]) => void,
  onError: (error: Error) => void,
  max = 25,
): () => void {
  const knowledgeQuery = query(
    collection(db, "knowledge"),
    where("ownerId", "==", ownerId),
    orderBy("createdAt", "desc"),
    limitTo(max),
  );

  return onSnapshot(knowledgeQuery, (snapshot) => onChange(mapKnowledgeSnapshot(snapshot)), onError);
}

/**
 * Restpunt (7 september 2026): de kennispagina luisterde tot nu toe met
 * `subscribeToKnowledge` (geen statusfilter) naar de 250 nieuwste
 * kennisitems van ALLE statussen door elkaar, en filterde pas daarna
 * client-side op status. Komt het totaal aantal kennisitems boven de 250,
 * dan vallen de OUDSTE wachtende items stilletjes uit dat venster zodra er
 * genoeg nieuwere (bijvoorbeeld goedgekeurde) items bijkomen — precies de
 * onzichtbaarheid die dit project elders bestrijdt, terwijl de Director ze
 * via een eigen, ongelimiteerde telling gewoon bleef meerekenen.
 *
 * Deze functie filtert daarom al IN de Firestore-query op status, met een
 * eigen (hoge) limiet per status: de groei van goedgekeurde items kan de
 * wachtrij dan nooit meer verdringen. Let op: dit matcht alleen documenten
 * waar het `status`-veld daadwerkelijk gezet is — oudere kennisitems zonder
 * dat veld (impliciet "approved", zie de kennispagina) worden hierdoor NIET
 * gevonden. Voor "pending" en "rejected" is dat geen probleem: nieuwe items
 * krijgen altijd expliciet een status.
 *
 * Vereist een samengestelde Firestore-index (ownerId + status + createdAt) —
 * zie firestore.indexes.json en de sectie "Firestore-index" in README.md.
 */
export function subscribeToKnowledgeByStatus(
  ownerId: string,
  status: KnowledgeStatus,
  onChange: (entries: KnowledgeEntry[]) => void,
  onError: (error: Error) => void,
  max = 1000,
): () => void {
  const knowledgeQuery = query(
    collection(db, "knowledge"),
    where("ownerId", "==", ownerId),
    where("status", "==", status),
    orderBy("createdAt", "desc"),
    limitTo(max),
  );

  return onSnapshot(knowledgeQuery, (snapshot) => onChange(mapKnowledgeSnapshot(snapshot)), onError);
}
