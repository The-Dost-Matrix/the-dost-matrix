import type { User } from "firebase/auth";
import type { DirectorDecision } from "@/core/contracts/v2";
import type { MissionRiskLevel, MissionV2 } from "@/core/mission-engine/v2/mission";
import type { MissionPullRequestStatus } from "@/core/mission-engine/v2/mission-pr-status";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

/**
 * Client-side wrappers rond /api/missions/v2. Net als bij chat-service.ts:
 * er wordt hier nooit rechtstreeks met Firestore of een LLM-provider
 * gepraat vanuit de browser — alles loopt via de server-only API-route.
 */

/**
 * Foutobject zoals dat door callMissionEngineApi naar de UI wordt gegooid.
 * Naast de mensleesbare `message` (standaard Error-gedrag) draagt dit
 * object optioneel een machineleesbaar `code`-veld, afkomstig van het
 * gelijknamige veld in de JSON-foutrespons van de API-route (zie
 * src/app/api/missions/v2/route.ts). Componenten mogen op dit veld
 * controleren in plaats van op de bewoording van `message` te matchen —
 * zie bijvoorbeeld mission-engine-v2-panel.tsx en de "NEEDS_SIGNOFF"-code
 * uit director-runtime.ts.
 */
export interface MissionEngineApiError extends Error {
  code?: string;
}

async function callMissionEngineApi<TResponse>(
  user: User,
  init: RequestInit,
): Promise<TResponse> {
  const idToken = await user.getIdToken();

  const response = await fetch("/api/missions/v2", {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${idToken}`,
      ...init.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error: MissionEngineApiError = new Error(
      data.error ?? "Aanvraag aan de Mission Engine is mislukt.",
    );
    if (typeof data.code === "string") {
      error.code = data.code;
    }
    throw error;
  }

  return data as TResponse;
}

export interface CreateMissionV2Input {
  title: string;
  objective: string;
  successCriteria: string[];
  constraints?: string[];
  /**
   * Risiconiveau van de missie zelf (LOW/MEDIUM/HIGH/CRITICAL) — bepaalt via
   * classifyPullRequestRiskForMission (zie risk-classification.ts) of de
   * Director een gehaalde missie nog automatisch mag mergen, los van hoe
   * klein de resulterende pull request is. Weggelaten (of niet meegegeven)
   * betekent LOW aan de serverkant (route.ts) — hetzelfde gedrag als vóór
   * dit veld bestond.
   */
  riskLevel?: MissionRiskLevel;
}

export async function createMissionV2(
  user: User,
  input: CreateMissionV2Input,
): Promise<MissionV2> {
  const data = await callMissionEngineApi<{ mission: MissionV2 }>(user, {
    method: "POST",
    body: JSON.stringify({ action: "create", ...input }),
  });

  return data.mission;
}

export async function listMissionsV2(user: User, limit = 5): Promise<MissionV2[]> {
  const idToken = await user.getIdToken();

  const response = await fetch(
    `/api/missions/v2?list=1&limit=${encodeURIComponent(String(limit))}`,
    {
      headers: { authorization: `Bearer ${idToken}` },
      cache: "no-store",
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error ?? "Missies ophalen is mislukt.");
  }

  return (data.missions as MissionV2[]) ?? [];
}

export async function getMissionV2(user: User, missionId: string): Promise<MissionV2> {
  const idToken = await user.getIdToken();

  const response = await fetch(
    `/api/missions/v2?missionId=${encodeURIComponent(missionId)}`,
    {
      headers: { authorization: `Bearer ${idToken}` },
      cache: "no-store",
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error ?? "Mission ophalen is mislukt.");
  }

  return data.mission as MissionV2;
}

/**
 * Stap 19: haalt de stand van de pull request en de CI op bij een missie.
 *
 * Apart van `getMissionV2` en niet standaard meegeleverd, want dit kost vier
 * GitHub-aanroepen en het paneel haalt de missie na elke handeling opnieuw op.
 *
 * `pullRequest` is null wanneer er nog geen pull request is (de normale stand
 * vóór de eerste builder-stap) én wanneer GitHub onbereikbaar was. Die twee
 * zijn hier bewust niet uit elkaar te houden: in beide gevallen is er niets te
 * tonen, en een foutmelding over GitHub in een informatiepaneel helpt niemand.
 */
export async function getMissionPullRequestStatusV2(
  user: User,
  missionId: string,
): Promise<MissionPullRequestStatus | null> {
  const idToken = await user.getIdToken();

  const response = await fetch(
    `/api/missions/v2?missionId=${encodeURIComponent(missionId)}&pullRequest=1`,
    {
      headers: { authorization: `Bearer ${idToken}` },
      cache: "no-store",
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error ?? "Stand van de pull request ophalen is mislukt.");
  }

  return (data.pullRequest as MissionPullRequestStatus | null) ?? null;
}

export async function dispatchMissionV2(
  user: User,
  missionId: string,
): Promise<MissionV2> {
  const data = await callMissionEngineApi<{ mission: MissionV2 }>(user, {
    method: "POST",
    body: JSON.stringify({ action: "dispatch", missionId }),
  });

  return data.mission;
}

export async function runMissionRoleV2(
  user: User,
  missionId: string,
): Promise<{ mission: MissionV2; roleOutput: string }> {
  return callMissionEngineApi<{ mission: MissionV2; roleOutput: string }>(user, {
    method: "POST",
    body: JSON.stringify({ action: "run-role", missionId }),
  });
}

export interface AutoStepMissionV2Result {
  mission: MissionV2;
  decision?: DirectorDecision;
  roleOutput?: string;
  usedKnowledge?: KnowledgeEntry[];
}

/**
 * Laat de Director zelf beslissen wat de eerstvolgende stap is, en voert die
 * (bij een dispatch naar de builder-rol) meteen ook uit. Dit is de
 * "zelfstandige Director"-actie — in plaats van zelf op dispatch + run-role
 * te klikken, doet één druk op de knop de hele stap.
 */
export async function autoStepMissionV2(
  user: User,
  missionId: string,
): Promise<AutoStepMissionV2Result> {
  return callMissionEngineApi<AutoStepMissionV2Result>(user, {
    method: "POST",
    body: JSON.stringify({ action: "auto-step", missionId }),
  });
}

/**
 * Annuleert een mission (bijvoorbeeld eentje die muurvast zit, zoals een
 * needs-signoff pull request die je liever niet via de Director oplost).
 * Zie de API-route voor de achtergrond: dit riep tot nu toe nergens
 * vandaan de al langer bestaande `engine.cancel()` aan.
 */
export async function cancelMissionV2(
  user: User,
  missionId: string,
  reason?: string,
): Promise<MissionV2> {
  const data = await callMissionEngineApi<{ mission: MissionV2 }>(user, {
    method: "POST",
    body: JSON.stringify({ action: "cancel", missionId, reason }),
  });

  return data.mission;
}

export interface ApproveAndMergeMissionV2Result {
  mission: MissionV2;
  pullRequestNumber: number;
  pullRequestUrl: string;
}

/**
 * Roadmap-stap 4: mergt de meest recente pull request van een missie
 * rechtstreeks vanuit de app — voor het geval de Director eerder een
 * needs-signoff-foutmelding gaf (zie director-runtime.ts). Verandert de
 * mission zelf niet; de eigenaar klikt daarna gewoon opnieuw op "volgende
 * stap" om de missie daadwerkelijk af te ronden.
 */
export async function approveAndMergeMissionV2(
  user: User,
  missionId: string,
): Promise<ApproveAndMergeMissionV2Result> {
  return callMissionEngineApi<ApproveAndMergeMissionV2Result>(user, {
    method: "POST",
    body: JSON.stringify({ action: "approve-and-merge", missionId }),
  });
}

/**
 * Roadmap-stap 12b: beantwoordt het openstaande inputverzoek van een missie
 * (mission.pendingOwnerInput) — de Director vroeg dit omdat QA een
 * succescriterium niet kon vaststellen, of omdat het inhoudelijke
 * herstelplafond bereikt was (zie owner-clarification.ts). Ging het verzoek
 * over een specifiek criterium (mission.pendingOwnerInput.relatedCriterionId
 * is dan gezet), geef dan `criterionOutcome` mee om dat criterium direct op
 * GEHAALD/NIET GEHAALD te zetten; laat het weg voor een generiek verzoek.
 */
export async function answerOwnerInputV2(
  user: User,
  missionId: string,
  response: string,
  criterionOutcome?: "PASSED" | "FAILED",
): Promise<MissionV2> {
  const data = await callMissionEngineApi<{ mission: MissionV2 }>(user, {
    method: "POST",
    body: JSON.stringify({ action: "answer-owner-input", missionId, response, criterionOutcome }),
  });

  return data.mission;
}
