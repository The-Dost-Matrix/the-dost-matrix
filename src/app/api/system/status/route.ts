import { NextRequest, NextResponse } from "next/server";

import { verifyIdToken } from "@/core/firebase/admin";
import { describeActiveChatModel } from "@/core/llm/model-router";
import { getDefaultBranch, getGithubRepoTarget } from "@/core/mission-engine/v2/github/github-client";
import { withOwnerLlmSettings } from "@/core/repositories/llm-settings-repository";
import {
  buildFirestoreStatus,
  buildGithubStatus,
  buildLlmStatus,
  type SystemStatusReport,
} from "@/core/system/system-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Levert de werkelijke systeemstatus voor het Command Center.
 *
 * Bewust achter authenticatie: de antwoorden vertellen welke integraties zijn
 * ingesteld en of ze werken. Er worden nooit sleutels, tokens of andere
 * geheimen teruggegeven — alleen namen van ontbrekende instellingen, het
 * actieve model, en de foutmelding van een mislukte aanroep.
 */
export async function GET(request: NextRequest) {
  let ownerId: string;

  try {
    const decoded = await verifyIdToken(request.headers.get("authorization"));
    ownerId = decoded.uid;
  } catch {
    return NextResponse.json(
      { error: "Je sessie is ongeldig of verlopen. Log opnieuw in." },
      { status: 401 },
    );
  }

  const githubStatus = await buildGithubStatus(process.env, async () => {
    const target = getGithubRepoTarget();
    const defaultBranch = await getDefaultBranch(target);
    return `${target.owner}/${target.repo} (${defaultBranch})`;
  });

  // Stap 24: binnen de wrapper, zodat dit paneel de keuze toont die de missies
  // ook werkelijk gebruiken — inclusief of die uit de instelling of uit de
  // omgeving komt. Zonder wrapper zou dit scherm altijd "omgeving" melden en
  // dus iets anders laten zien dan er draait.
  const llmStatus = await withOwnerLlmSettings(ownerId, async () =>
    buildLlmStatus(describeActiveChatModel()),
  );

  const report: SystemStatusReport = {
    checkedAt: new Date().toISOString(),
    components: [llmStatus, githubStatus, buildFirestoreStatus(process.env)],
  };

  return NextResponse.json(report);
}
