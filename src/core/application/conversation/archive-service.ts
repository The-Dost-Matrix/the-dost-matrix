import { createHash } from "node:crypto";

import { getEmbeddingProvider } from "@/core/llm/model-router";
import {
  archiveConversation,
  archiveConversationChunk,
  findConversationByFingerprint,
} from "@/core/repositories/conversation-archive-repository";

import { splitConversationIntoChunks } from "./chunk-service";

export function createConversationFingerprint(
  filename: string,
  content: string,
): string {
  return createHash("sha256")
    .update(
      `${filename.trim().toLowerCase()}\n${content
        .trim()
        .replace(/\r\n/g, "\n")}`,
    )
    .digest("hex");
}

export function normalizeConversationContent(
  content: string,
): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export interface ArchiveConversationServiceInput {
  ownerId: string;
  filename: string;
  content: string;
  /**
   * Verwerk het gesprek opnieuw, ook wanneer exact deze inhoud al
   * gearchiveerd is. Bedoeld voor het geval dat de chunkstructuur of het
   * embedding-model verandert en oude archieven bijgewerkt moeten worden —
   * precies waarvoor de duplicaatcontrole hieronder ooit tijdelijk is
   * uitgezet. Nu is het een bewuste keuze van de aanroeper in plaats van
   * permanent gedrag.
   */
  forceReprocess?: boolean;
}

export interface ArchiveConversationServiceResult {
  conversationId: string;
  /** Aantal NIEUW weggeschreven chunks. Nul bij een herkend duplicaat. */
  chunks: number;
  embedded: boolean;
  /** true wanneer dit gesprek al woordelijk in het archief stond. */
  duplicate: boolean;
}

/**
 * Archiveert een gesprek, tenzij exact dezelfde inhoud er al in staat.
 *
 * Die duplicaatcontrole stond hier al vanaf het begin — maar werkte sinds een
 * tijdelijke ingreep niet meer. Het `if`-blok dat het archiveren moest
 * overslaan bevatte alleen nog een commentaarregel ("Tijdelijk opnieuw
 * verwerken zodat oude archieven de nieuwe, kleinere chunkstructuur krijgen"),
 * waardoor de controle wél werd uitgevoerd maar nooit ergens toe leidde. De
 * eenmalige herverwerking waarvoor dat bedoeld was is allang gebeurd; wat
 * overbleef was een gesprek dat bij elke import opnieuw volledig werd
 * opgeslagen, inclusief alle chunks en alle betaalde embeddings.
 *
 * Vastgesteld tijdens de code-audit van 13 september 2026. De tijdelijke
 * ingreep is nu een expliciete `forceReprocess`-optie, zodat dezelfde
 * herverwerking opnieuw kan wanneer dat nodig is — maar alleen wanneer de
 * aanroeper daar zelf om vraagt.
 */
export async function archiveConversationDocument(
  input: ArchiveConversationServiceInput,
): Promise<ArchiveConversationServiceResult> {
  const content = normalizeConversationContent(
    input.content,
  );

  const fingerprint =
    createConversationFingerprint(
      input.filename,
      content,
    );

  const existing =
    await findConversationByFingerprint(
      input.ownerId,
      fingerprint,
    );

  if (existing && !input.forceReprocess) {
    return {
      conversationId: existing.id,
      chunks: 0,
      embedded: false,
      duplicate: true,
    };
  }

  const conversationId =
    await archiveConversation({
      ownerId: input.ownerId,
      filename: input.filename,
      content,
      fingerprint,
      archivedAt: new Date(),
    });

  const chunks =
    splitConversationIntoChunks(content);

  const embeddingProvider =
    getEmbeddingProvider();

  for (
    let index = 0;
    index < chunks.length;
    index += 1
  ) {
    const chunk = chunks[index];

    const embedding = embeddingProvider
      ? await embeddingProvider.embed(chunk)
      : [];

    await archiveConversationChunk({
      ownerId: input.ownerId,
      conversationId,
      filename: input.filename,
      chunkIndex: index,
      content: chunk,
      embedding,
    });
  }

  return {
    conversationId,
    chunks: chunks.length,
    embedded: Boolean(embeddingProvider),
    duplicate: false,
  };
}

/*
 * Hier stond `shouldReprocessConversation(existingFingerprint, newFingerprint)`.
 * Verwijderd bij de code-audit van 13 september 2026, om twee redenen.
 *
 * Ten eerste werd hij nergens anders gebruikt of getest. Ten tweede — en dat
 * is de echte reden — was zijn enige aanroep hierboven noodzakelijkerwijs
 * altijd waar: het bestaande gesprek werd OPGEZOCHT op fingerprint, dus zijn
 * fingerprint was per definitie gelijk aan de nieuwe. De functie zag eruit als
 * een inhoudelijke controle, maar vergeleek een waarde met zichzelf.
 *
 * Dat is gevaarlijker dan geen controle: een lezer die hem tegenkomt gaat
 * ervan uit dat hier iets wordt afgewogen. De expliciete `if (existing &&
 * !input.forceReprocess)` hierboven doet wat er werkelijk moet gebeuren, en
 * liegt niet over wat hij afweegt.
 */