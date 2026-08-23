import { getChatProvider } from "@/core/llm/model-router";
import type {
  KnowledgeEntry,
  KnowledgeReview,
  KnowledgeReviewRecommendation,
} from "@/core/domain/knowledge/knowledge-entry";

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function isRecommendation(
  value: unknown,
): value is KnowledgeReviewRecommendation {
  return (
    value === "approve" ||
    value === "edit" ||
    value === "reject"
  );
}

export async function reviewKnowledgeEntry(
  entry: KnowledgeEntry,
): Promise<KnowledgeReview> {
  const provider = getChatProvider();

  const result = await provider.chatCompletion(
    `
Je bent de Knowledge Review Agent van The Dost Matrix.

Je beoordeelt of een kennisitem geschikt is voor permanente opname in de Knowledge Foundation.

Geef uitsluitend geldige JSON terug. Gebruik geen markdown-hekken en geen aanvullende tekst.

Schema:
{
  "recommendation": "approve" | "edit" | "reject",
  "confidence": 0.0,
  "reason": "Beknopte maar duidelijke motivatie in het Nederlands.",
  "issues": ["aandachtspunt"],
  "suggestedTitle": "optionele verbeterde titel",
  "suggestedContent": "optionele verbeterde inhoud"
}

Beoordelingsregels:

1. APPROVE
Gebruik wanneer het item:
- duurzame kennis bevat;
- zelfstandig begrijpelijk is;
- een blijvend feit, principe, risico, proces of besluit beschrijft;
- geen onnodige tijdelijke implementatiedetails bevat;
- voldoende duidelijk en nauwkeurig is.

2. EDIT
Gebruik wanneer de kern waardevol is, maar het item:
- tijdgebonden of versiegebonden is geformuleerd;
- meerdere losse kennisfeiten combineert;
- een tijdelijke projectnaam of configuratiewaarde bevat;
- te vaag of te contextafhankelijk is;
- tijdlozer of preciezer geformuleerd kan worden.

Bij EDIT moet je altijd suggestedTitle en suggestedContent teruggeven.

3. REJECT
Gebruik wanneer het item hoofdzakelijk bestaat uit:
- installatie-instructies;
- tijdelijke projectstatus;
- een TODO;
- changeloginformatie;
- een foutmelding;
- een vluchtige planning;
- herhaling zonder nieuwe informatiewaarde;
- betekenisloze implementatiedetails.

Aanvullende regels:
- Beoordeel de inhoud, niet alleen de titel.
- Een versienummer is niet automatisch fout, maar wel verdacht wanneer het geen blijvende betekenis heeft.
- Een concrete regio, projectnaam of configuratiewaarde mag blijven staan wanneer deze bewust onderdeel is van een architectuurbesluit.
- Verzin geen nieuwe feiten.
- suggestedContent moet dezelfde betekenis behouden als de bron.
- confidence moet tussen 0 en 1 liggen.
- issues moet een lege array zijn wanneer er geen aandachtspunten zijn.
`.trim(),
    [
      {
        role: "user",
        content: JSON.stringify(
            {
              type: entry.type ?? null,
              title: entry.title ?? null,
              summary: entry.summary ?? null,
              content: entry.content,
              project: entry.project ?? null,
              source: entry.source,
              sourceDocument: entry.sourceDocument ?? null,
              sourceSection: entry.sourceSection ?? null,
              extractionConfidence: entry.confidence ?? null,
              tags: entry.tags,
            },
            null,
            2,
          ),
      },
    ],
  );

  let parsed: unknown;

  try {
    parsed = JSON.parse(stripCodeFence(result.content));
  } catch {
    throw new Error("De Review Agent gaf geen geldige JSON terug.");
  }

  const review = parsed as Partial<KnowledgeReview>;

  if (!isRecommendation(review.recommendation)) {
    throw new Error("De Review Agent gaf geen geldig advies terug.");
  }

  const confidence = Math.max(
    0,
    Math.min(1, Number(review.confidence ?? 0)),
  );

  const reason =
    typeof review.reason === "string"
      ? review.reason.trim()
      : "";

  if (!reason) {
    throw new Error("De Review Agent gaf geen motivatie terug.");
  }

  const issues = Array.isArray(review.issues)
    ? review.issues
        .filter((issue): issue is string => typeof issue === "string")
        .map((issue) => issue.trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];

  const suggestedTitle =
    typeof review.suggestedTitle === "string"
      ? review.suggestedTitle.trim().slice(0, 100)
      : undefined;

  const suggestedContent =
    typeof review.suggestedContent === "string"
      ? review.suggestedContent.trim()
      : undefined;

  if (
    review.recommendation === "edit" &&
    (!suggestedTitle || !suggestedContent)
  ) {
    throw new Error(
      "De Review Agent adviseerde bewerken, maar gaf geen volledig tekstvoorstel terug.",
    );
  }

  return {
    recommendation: review.recommendation,
    confidence,
    reason,
    issues,
    suggestedTitle,
    suggestedContent,
    reviewedAt: new Date(),
    model: result.model,
  };
}