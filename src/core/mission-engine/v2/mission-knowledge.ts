import { getChatProvider } from "@/core/llm/model-router";
import { createKnowledgeEntry } from "@/core/repositories/knowledge-repository";
import {
  reviewKnowledgeItems,
  type ExtractedKnowledgeItem,
} from "@/core/knowledge/knowledge-architect";
import type { KnowledgeType } from "@/core/domain/knowledge/knowledge-entry";

import type { MissionV2 } from "./mission";

/**
 * Sluit de Second Brain-leerlus voor Mission Engine V2: tot nu toe kwamen
 * kennisvoorstellen uitsluitend uit de chat (zie parseKnowledgeProposal in
 * chat-service.ts) of uit document-import (zie api/knowledge/import). Een
 * afgeronde of geannuleerde missie leverde nooit automatisch kennis op, ook
 * niet wanneer er onderweg een duidelijke les, risico of besluit naar voren
 * kwam (bv. in een QA-toelichting op een FAILED-criterium).
 *
 * `proposeMissionKnowledge` haalt dat soort duurzame kennis alsnog uit een
 * afgesloten missie en legt het net als de andere twee bronnen ter
 * beoordeling voor (status "pending" — nooit automatisch goedgekeurd, dat
 * blijft een bewuste stap van de eigenaar op de Kennis-pagina).
 *
 * Bewuste scope-keuze: Mission Engine V2 heeft momenteel geen enkele
 * aanroeper van `engine.fail()` (de FAILED-status wordt nergens bereikt —
 * een mislukte toewijzing leidt tot REPLANNING, niet tot een mislukte
 * missie). "Failed missions" uit de oorspronkelijke opzet ("completed/failed
 * missions automatically propose knowledge items") is dus vandaag nog dode
 * code. Deze functie is daarom gekoppeld aan de twee terugkerende
 * eindstatussen die wél voorkomen: COMPLETED (zie director-runtime.ts) en
 * CANCELLED (zie de "cancel"-actie in api/missions/v2/route.ts). Zodra er
 * ooit een aanroeper van `engine.fail()` bijkomt, moet die dezelfde aanroep
 * doen met outcome "failed" — de logica hieronder ondersteunt dat al.
 *
 * Bewust best-effort: een fout hier (bv. de LLM-provider geeft geen geldige
 * JSON terug) mag nooit de afronding of annulering van de missie zelf laten
 * mislukken — dezelfde "fail-open op een randgeval, maar nooit de
 * hoofdstroom breken"-filosofie als bij de CI-statuscontrole in
 * github-client.ts.
 */

export type MissionKnowledgeOutcome = "completed" | "failed" | "cancelled";

const KNOWLEDGE_TYPE_VALUES: readonly KnowledgeType[] = [
  "vision",
  "goal",
  "decision",
  "architecture",
  "project",
  "process",
  "preference",
  "lesson",
  "task",
  "risk",
  "open_question",
  "person",
  "company",
  "fact",
];

function isKnowledgeType(value: unknown): value is KnowledgeType {
  return (
    typeof value === "string" &&
    (KNOWLEDGE_TYPE_VALUES as readonly string[]).includes(value)
  );
}

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function outcomeLabel(outcome: MissionKnowledgeOutcome): string {
  switch (outcome) {
    case "completed":
      return "VOLTOOID";
    case "failed":
      return "MISLUKT";
    case "cancelled":
      return "GEANNULEERD";
  }
}

function buildMissionNarrative(
  mission: MissionV2,
  outcome: MissionKnowledgeOutcome,
): string {
  const criteriaLines = mission.successCriteria.map((criterion) => {
    const note = criterion.lastEvaluationNote?.trim();
    return note
      ? `- (${criterion.status}) ${criterion.description} — toelichting: ${note}`
      : `- (${criterion.status}) ${criterion.description}`;
  });

  const assignmentLines =
    mission.assignments.length === 0
      ? ["Geen toewijzingen."]
      : mission.assignments.map(
          (assignment, index) =>
            `${index + 1}. rol=${assignment.roleId}, status=${assignment.status}, opdracht="${assignment.objective}"`,
        );

  const lines = [
    `Missie: "${mission.title}"`,
    `Doel: ${mission.objective}`,
    `Eindstatus: ${outcomeLabel(outcome)}`,
  ];

  if (outcome === "failed" && mission.failureReason) {
    lines.push(`Reden van mislukken: ${mission.failureReason}`);
  }
  if (outcome === "cancelled" && mission.cancellationReason) {
    lines.push(`Reden van annulering: ${mission.cancellationReason}`);
  }

  lines.push("", "Succescriteria:", ...criteriaLines);
  lines.push("", "Toewijzingen:", ...assignmentLines);

  return lines.join("\n");
}

function buildExtractionPrompt(
  mission: MissionV2,
  outcome: MissionKnowledgeOutcome,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "Je bent de Knowledge Architect van The Dost Matrix.",
    "Je destilleert duurzame kennis uit een afgesloten missie voor het Second Brain.",
    "Geef uitsluitend geldige JSON terug: een array, zonder markdown-hekken en zonder aanvullende tekst.",
  ].join(" ");

  const userPrompt = [
    buildMissionNarrative(mission, outcome),
    "",
    "Haal hier UITSLUITEND kennis uit die blijvende waarde heeft: een architectuurbesluit, een les, een ontdekt risico, een blijvend feit, een openstaande vraag, of een duurzame voorkeur/proces-afspraak.",
    "Negeer: de kale constatering dat deze missie is voltooid/mislukt/geannuleerd, tijdelijke implementatiedetails, statusupdates, en alles wat al vanzelfsprekend is uit de missietitel zonder nieuwe inhoud toe te voegen.",
    "Geef een LEGE array [] terug wanneer er niets van blijvende waarde uit deze missie te halen valt — dat is een prima en verwacht antwoord, forceer niets.",
    "",
    "Schema per item in de array:",
    "{",
    '  "title": "korte, zelfstandig begrijpelijke titel",',
    '  "content": "de kennis zelf, zelfstandig begrijpelijk zonder deze missie te kennen",',
    `  "type": een van: ${KNOWLEDGE_TYPE_VALUES.join(", ")},`,
    '  "tags": ["optioneel", "kort", "trefwoorden"]',
    "}",
    "",
    "Verzin geen feiten die niet uit de missie hierboven blijken.",
  ].join("\n");

  return { systemPrompt, userPrompt };
}

async function extractMissionKnowledgeItems(
  mission: MissionV2,
  outcome: MissionKnowledgeOutcome,
): Promise<ExtractedKnowledgeItem[]> {
  const provider = getChatProvider();
  const { systemPrompt, userPrompt } = buildExtractionPrompt(mission, outcome);

  const completion = await provider.chatCompletion(systemPrompt, [
    { role: "user", content: userPrompt },
  ]);

  const parsed: unknown = JSON.parse(stripCodeFence(completion.content));

  if (!Array.isArray(parsed)) {
    throw new Error("De Knowledge Architect gaf geen JSON-array terug.");
  }

  const items: ExtractedKnowledgeItem[] = [];

  for (const candidate of parsed) {
    if (typeof candidate !== "object" || candidate === null) continue;

    const entry = candidate as Record<string, unknown>;
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    const content =
      typeof entry.content === "string" ? entry.content.trim() : "";

    // Onbekende/ongeldige items worden stilzwijgend overgeslagen in plaats
    // van de hele extractie te laten mislukken — één misvormd item van de
    // LLM mag de rest van een geldig voorstel niet blokkeren.
    if (!title || !content || !isKnowledgeType(entry.type)) continue;

    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined;

    items.push({ title, content, type: entry.type, tags });
  }

  return items;
}

/**
 * Stelt kennisitems voor uit een afgesloten missie en legt ze — net als
 * chat- en document-voorstellen — ter beoordeling voor in het Second Brain.
 * Gooit zelf nooit een fout: elke stap hierbinnen is best-effort, zodat een
 * probleem met kennisextractie nooit de afronding/annulering van de missie
 * zelf kan laten mislukken.
 */
export async function proposeMissionKnowledge(
  mission: MissionV2,
  outcome: MissionKnowledgeOutcome,
): Promise<void> {
  try {
    const items = await extractMissionKnowledgeItems(mission, outcome);
    const reviewed = reviewKnowledgeItems(items);

    for (const item of reviewed) {
      await createKnowledgeEntry({
        ownerId: mission.ownerId,
        type: item.type,
        title: item.title,
        content: item.content,
        lifecycle: item.lifecycle,
        source: "mission",
        sourceDocument: mission.title,
        sourceSection: item.section,
        status: "pending",
        confidence: 0.7,
        tags: Array.from(
          new Set(["missie", outcome, ...(item.tags ?? [])]),
        ),
      });
    }
  } catch (error) {
    console.error(
      `[mission-knowledge] Kon geen kennis voorstellen voor missie ${mission.missionId} (${outcome}):`,
      error,
    );
  }
}
