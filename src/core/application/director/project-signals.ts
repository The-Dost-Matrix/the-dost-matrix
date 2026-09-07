import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";
import { getKnowledgeEntries } from "@/core/repositories/knowledge-repository";
import {
  countCommitsSince,
  getGithubRepoTarget,
  getLatestCommitForPath,
  listPullRequests,
} from "@/core/mission-engine/v2/github/github-client";

import type { OpenPullRequestEntry, RoadmapFreshness } from "./project-state";

/**
 * Het ophalen van de signalen die zichzelf bijwerken, voor de Director-chat.
 *
 * WAAROM APART VAN project-state.ts
 *
 * Dezelfde scheiding als bij ci-failure-report.ts (puur) en
 * ci-failure-source.ts (haalt op): de opmaak is zonder netwerk te testen, en
 * dit bestand blijft een dunne laag die alleen ophaalt en fouten wegvangt.
 *
 * WAAROM ELKE FOUT NULL WORDT EN NOOIT GOOIT
 *
 * Dit hangt aan elk chatbericht. Een chat die weigert omdat GitHub even
 * traag is zou een verslechtering zijn, en belangrijker: de aanroeper maakt
 * onderscheid tussen "niets gevonden" (lege lijst, nul) en "niet kunnen
 * ophalen" (null), en zegt dat verschil ook tegen de Director. Een fout stil
 * laten wegvallen als "geen openstaande pull requests" zou precies de
 * geruststelling opleveren die dit hele blok moet voorkomen.
 */

/**
 * Hoeveel kennisitems er worden ingelezen om de wachtenden te tellen.
 * Dezelfde grens als de standaard van getKnowledgeEntries; hoger tellen kost
 * een grotere Firestore-lezing bij elk chatbericht zonder dat "veel" iets
 * anders wordt dan "veel".
 */
export const MAX_KNOWLEDGE_ENTRIES_SCANNED = 500;

/** Het bestand waarvan de ouderdom bepaalt of de roadmap achterloopt. */
export const ROADMAP_PATH = "docs/roadmap.md";

export interface ProjectSignals {
  /** Openstaande pull requests, of null wanneer GitHub niet bereikbaar was. */
  openPullRequests: OpenPullRequestEntry[] | null;
  /** Kennisitems op "pending", of null wanneer Firestore niet bereikbaar was. */
  pendingKnowledgeCount: number | null;
  /** Ouderdom van de roadmap, of null wanneer die niet vast te stellen was. */
  roadmapFreshness: RoadmapFreshness | null;
}

/** Haalt de openstaande pull requests op; null bij elke fout. */
export async function fetchOpenPullRequests(): Promise<OpenPullRequestEntry[] | null> {
  try {
    const target = getGithubRepoTarget();
    const pullRequests = await listPullRequests(target, "open");

    return pullRequests.map((pullRequest) => ({
      number: pullRequest.number,
      title: pullRequest.title,
      createdAt: pullRequest.createdAt ?? null,
    }));
  } catch {
    return null;
  }
}

/** Telt de kennisitems die op beoordeling wachten; null bij elke fout. */
export async function fetchPendingKnowledgeCount(ownerId: string): Promise<number | null> {
  try {
    const entries: KnowledgeEntry[] = await getKnowledgeEntries(
      ownerId,
      MAX_KNOWLEDGE_ENTRIES_SCANNED,
    );

    return entries.filter((entry) => entry.status === "pending").length;
  } catch {
    return null;
  }
}

/**
 * Bepaalt hoe ver de roadmap achterloopt: wanneer docs/roadmap.md voor het
 * laatst is aangeraakt, en hoeveel commits er daarna zijn geland.
 *
 * Twee aanvragen, want GitHub kan dit niet in één keer: eerst de laatste
 * commit op dat pad, dan het aantal commits sinds dat tijdstip.
 */
export async function fetchRoadmapFreshness(): Promise<RoadmapFreshness | null> {
  try {
    const target = getGithubRepoTarget();
    const lastCommit = await getLatestCommitForPath(target, ROADMAP_PATH);

    if (!lastCommit) return null;

    const { count, capped } = await countCommitsSince(target, lastCommit.committedAt);

    return {
      lastUpdatedIso: lastCommit.committedAt,
      commitsSince: count,
      capped,
    };
  } catch {
    return null;
  }
}

/**
 * Alle zelf-bijwerkende signalen tegelijk. Parallel, omdat ze niets van
 * elkaar nodig hebben en dit aan de wachttijd van elk chatbericht hangt.
 */
export async function collectProjectSignals(ownerId: string): Promise<ProjectSignals> {
  const [openPullRequests, pendingKnowledgeCount, roadmapFreshness] = await Promise.all([
    fetchOpenPullRequests(),
    fetchPendingKnowledgeCount(ownerId),
    fetchRoadmapFreshness(),
  ]);

  return { openPullRequests, pendingKnowledgeCount, roadmapFreshness };
}
