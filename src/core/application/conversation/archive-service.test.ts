import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regressietests bij de code-audit van 13 september 2026.
 *
 * De duplicaatcontrole in archive-service.ts stond er wel, maar deed niets:
 * het `if`-blok dat het archiveren moest overslaan bevatte uitsluitend een
 * commentaarregel over een tijdelijke herverwerking. Gevolg was dat exact
 * dezelfde conversatie bij elke import opnieuw volledig werd weggeschreven,
 * inclusief alle chunks en alle betaalde embeddings.
 *
 * Deze tests leggen het herstelde gedrag vast, zodat een volgende "tijdelijke"
 * ingreep niet opnieuw stilzwijgend kan blijven staan: een verwijderde
 * short-circuit laat hier meteen een rode test achter.
 */
vi.mock("@/core/repositories/conversation-archive-repository", () => ({
  archiveConversation: vi.fn(),
  archiveConversationChunk: vi.fn(),
  findConversationByFingerprint: vi.fn(),
}));

vi.mock("@/core/llm/model-router", () => ({
  getEmbeddingProvider: vi.fn(),
}));

import { archiveConversationDocument } from "./archive-service";
import {
  archiveConversation,
  archiveConversationChunk,
  findConversationByFingerprint,
} from "@/core/repositories/conversation-archive-repository";
import { getEmbeddingProvider } from "@/core/llm/model-router";

const mockedFind = vi.mocked(findConversationByFingerprint);
const mockedArchive = vi.mocked(archiveConversation);
const mockedArchiveChunk = vi.mocked(archiveConversationChunk);
const mockedEmbeddingProvider = vi.mocked(getEmbeddingProvider);

const ownerId = "owner-1";
const filename = "Chat 2026-09-13.md";
const content = "Een gesprek met genoeg inhoud om te archiveren.";

beforeEach(() => {
  vi.clearAllMocks();
  mockedEmbeddingProvider.mockReturnValue(null);
  mockedArchive.mockResolvedValue("conversation-new");
});

describe("archiveConversationDocument", () => {
  it("archiveert een nog onbekende conversatie en schrijft chunks weg", async () => {
    mockedFind.mockResolvedValue(null);

    const result = await archiveConversationDocument({
      ownerId,
      filename,
      content,
    });

    expect(result.duplicate).toBe(false);
    expect(result.conversationId).toBe("conversation-new");
    expect(result.chunks).toBeGreaterThan(0);
    expect(mockedArchive).toHaveBeenCalledTimes(1);
    expect(mockedArchiveChunk).toHaveBeenCalled();
  });

  it("slaat een woordelijk identieke conversatie over zonder opnieuw op te slaan", async () => {
    mockedFind.mockResolvedValue({
      id: "conversation-bestaand",
      ownerId,
      filename,
      content,
      fingerprint: "maakt-niet-uit",
      archivedAt: null,
      createdAt: null,
    });

    const result = await archiveConversationDocument({
      ownerId,
      filename,
      content,
    });

    expect(result.duplicate).toBe(true);
    expect(result.conversationId).toBe("conversation-bestaand");
    expect(result.chunks).toBe(0);

    // De kern van de regressie: niets mag opnieuw worden weggeschreven.
    expect(mockedArchive).not.toHaveBeenCalled();
    expect(mockedArchiveChunk).not.toHaveBeenCalled();
  });

  it("verwerkt een bestaande conversatie wél opnieuw wanneer forceReprocess is gevraagd", async () => {
    mockedFind.mockResolvedValue({
      id: "conversation-bestaand",
      ownerId,
      filename,
      content,
      fingerprint: "maakt-niet-uit",
      archivedAt: null,
      createdAt: null,
    });

    const result = await archiveConversationDocument({
      ownerId,
      filename,
      content,
      forceReprocess: true,
    });

    expect(result.duplicate).toBe(false);
    expect(mockedArchive).toHaveBeenCalledTimes(1);
    expect(mockedArchiveChunk).toHaveBeenCalled();
  });

  it("beschouwt inhoud die alleen in regeleindes of witruimte verschilt als hetzelfde gesprek", async () => {
    mockedFind.mockResolvedValue(null);

    await archiveConversationDocument({
      ownerId,
      filename,
      content: "regel een\nregel twee",
    });

    const firstFingerprint = mockedArchive.mock.calls[0][0].fingerprint;

    vi.clearAllMocks();
    mockedEmbeddingProvider.mockReturnValue(null);
    mockedArchive.mockResolvedValue("conversation-new");
    mockedFind.mockResolvedValue(null);

    await archiveConversationDocument({
      ownerId,
      filename,
      content: "regel een   \r\nregel twee\r\n",
    });

    expect(mockedArchive.mock.calls[0][0].fingerprint).toBe(firstFingerprint);
  });
});
