import type { User } from "firebase/auth";
import type { DirectorDecision } from "@/core/contracts/v2";
import type { MissionRiskLevel, MissionV2 } from "@/core/mission-engine/v2/mission";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

/**
 * Client-side wrappers rond /api/missions/v2. Net als bij chat-service.ts:
 * er wordt hier nooit rechtstreeks met Firestore of een LLM-provider
 * gepraat vanuit de browser — alles loopt via de server-only API-route.
 */

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
    throw new Error(data.error ?? "Aanvraag aan de Mission Engine is mislukt.");
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
