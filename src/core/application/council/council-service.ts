import { readWorkspaceFiles } from "@/core/application/codebase/workspace-reader";
import {
  ROADMAP_PATH,
  collectProjectSignals,
} from "@/core/application/director/project-signals";
import { buildProjectStateBlock } from "@/core/application/director/project-state";
import { getCouncilProviders } from "@/core/llm/model-router";
import type { LlmProvider } from "@/core/llm/types";
import { createUsageTracker } from "@/core/llm/usage-tracker";
import { listMissionsForOwner } from "@/core/mission-engine/v2/firestore-store";
import {
  buildCouncilRoundOneSystemPrompt,
  buildCouncilRoundOneUserMessage,
  buildCouncilRoundTwoSystemPrompt,
  buildCouncilRoundTwoUserMessage,
  parseCouncilVerdict,
} from "./council-texts";
import type { CouncilMemberResult, CouncilSessionResult } from "./council-texts";

/**
 * Stap 13 — The Dost Council V1 (dun): orkestreert de drie ronden met de
 * echte LLM-aanroepen. Alle tekst en parsing staan in council-texts.ts
 * (netwerkvrij testbaar); hier gebeurt alleen het ophalen van bewijs, het
 * aanroepen van de twee providers, en het optellen van kosten.
 *
 * BEWUST GEEN hergebruik van de volledige sendChatMessage-pijplijn
 * (chat-service.ts): geen semantisch Second Brain-geheugen, geen volledige
 * codebase-boom, geen <workspace-read>-lus, geen <create-mission>-afhandeling.
 * Dat hoort bij de Director zelf. De raad krijgt hier dezelfde "projectstand"
 * (roadmap + recente missies + de zelf-bijwerkende signalen) die de Director
 * ook als eerste blok ziet — genoeg gegronde context voor een strategische
 * vraag, zonder de zwaardere, foutgevoeligere onderdelen van de Director-chat
 * te dupliceren. Dit is precies de afgebakende V1-scope uit de roadmap:
 * geen Claim Ledger, geen extra providers, geen automatische triggers.
 */

// Zelfde grens als MAX_CHAT_CONTENT_LENGTH in chat-service.ts, bewust als
// eigen, hier geëxporteerde constante in plaats van een import daarvandaan:
// chat-service.ts trekt bij het laden meteen adminDb, de embedding-provider
// en de volledige Director-pijplijn mee, precies de zwaardere afhankelijk-
// heden die dit bestand (zie de toelichting hierboven) expliciet niet wil
// overnemen — ook niet via de API-route (zie app/api/council/ask/route.ts).
export const MAX_COUNCIL_QUESTION_LENGTH = 8_000;

async function buildCouncilEvidence(ownerId: string): Promise<string> {
  const [roadmapResults, recentMissions, projectSignals] = await Promise.all([
    readWorkspaceFiles([ROADMAP_PATH]),
    // Een mislukte missie-ophaling mag een raadsessie nooit blokkeren — zie
    // dezelfde afweging in chat-service.ts.
    listMissionsForOwner(ownerId, 20).catch(() => []),
    collectProjectSignals(ownerId),
  ]);

  const roadmapResult = roadmapResults[0];

  return buildProjectStateBlock({
    roadmapText: roadmapResult && "content" in roadmapResult ? roadmapResult.content : "",
    roadmapUnavailableReason:
      roadmapResult && "error" in roadmapResult ? roadmapResult.error : null,
    missions: recentMissions.map((mission) => ({
      status: mission.status,
      title: mission.title,
    })),
    openPullRequests: projectSignals.openPullRequests,
    pendingKnowledgeCount: projectSignals.pendingKnowledgeCount,
    roadmapFreshness: projectSignals.roadmapFreshness,
  });
}

interface CouncilMember {
  providerId: string;
  provider: LlmProvider;
}

export async function runCouncilSession(
  ownerId: string,
  question: string,
): Promise<CouncilSessionResult> {
  const trimmed = question.trim();
  if (!trimmed) throw new Error("Een vraag aan de raad mag niet leeg zijn.");
  if (trimmed.length > MAX_COUNCIL_QUESTION_LENGTH) {
    throw new Error(
      `Een vraag aan de raad mag maximaal ${MAX_COUNCIL_QUESTION_LENGTH} tekens bevatten.`,
    );
  }

  const { anthropic, openai } = getCouncilProviders();
  const members: readonly CouncilMember[] = [
    { providerId: "anthropic", provider: anthropic },
    { providerId: "openai", provider: openai },
  ];

  const usage = createUsageTracker();
  const evidence = await buildCouncilEvidence(ownerId);

  // Ronde 1: blind en parallel — geen van beide aanroepen ziet de ander.
  const roundOne = await Promise.all(
    members.map(async ({ providerId, provider }) => {
      const completion = await provider.chatCompletion(buildCouncilRoundOneSystemPrompt(), [
        { role: "user", content: buildCouncilRoundOneUserMessage(trimmed, evidence) },
      ]);
      usage.add(completion);
      return { providerId, model: completion.model, analysis: completion.content };
    }),
  );

  // Ronde 2: geanonimiseerde wederzijdse kritiek — elk lid ziet uitsluitend
  // de ronde-1-analyse van het ANDERE lid, nooit welke provider erachter zit.
  const roundTwo: CouncilMemberResult[] = await Promise.all(
    roundOne.map(async (own, index) => {
      const other = roundOne[(index + 1) % roundOne.length];
      const completion = await members[index].provider.chatCompletion(
        buildCouncilRoundTwoSystemPrompt(),
        [
          {
            role: "user",
            content: buildCouncilRoundTwoUserMessage(trimmed, evidence, other.analysis),
          },
        ],
      );
      usage.add(completion);

      return {
        providerId: own.providerId,
        model: own.model,
        analysis: own.analysis,
        critique: completion.content,
        verdict: parseCouncilVerdict(completion.content),
      };
    }),
  );

  // Ronde 3: deterministisch, in code — geen derde LLM-aanroep die de
  // onenigheid zou kunnen wegsynthetiseren. Alleen wanneer ELK lid expliciet
  // EENS zei geldt dit als overeenstemming; ONDUIDELIJK telt nooit mee als
  // instemming (zie parseCouncilVerdict in council-texts.ts).
  const agreement = roundTwo.every((member) => member.verdict === "EENS");

  return {
    question: trimmed,
    members: roundTwo,
    agreement,
    estimatedCostUsd: usage.totals().cost,
  };
}
