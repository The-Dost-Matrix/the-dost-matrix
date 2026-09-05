import { NextRequest, NextResponse } from "next/server";

import { verifyIdToken } from "@/core/firebase/admin";
import { describeActiveChatModel } from "@/core/llm/model-router";
import { getDefaultBranch, getGithubRepoTarget } from "@/core/mission-engine/v2/github/github-client";
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
  try {
    await verifyIdToken(request.headers.get("authorization"));
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

  const report: SystemStatusReport = {
    checkedAt: new Date().toISOString(),
    components: [
      buildLlmStatus(describeActiveChatModel()),
      githubStatus,
      buildFirestoreStatus(process.env),
    ],
  };

  return NextResponse.json(report);
}
