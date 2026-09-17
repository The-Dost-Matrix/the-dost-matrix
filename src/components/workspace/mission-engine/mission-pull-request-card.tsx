"use client";

import { useCallback, useEffect, useState } from "react";

import type { MissionPullRequestStatus } from "@/core/mission-engine/v2/mission-pr-status";
import { needsAttention } from "@/core/mission-engine/v2/mission-pr-status";
import { useAuth } from "@/domains/auth/auth-provider";
import { useMissionEngine } from "@/domains/missions/mission-engine-store";
import { getMissionPullRequestStatusV2 } from "@/domains/missions/mission-engine-v2-service";
import {
  behindByLabel,
  ciStatusLabel,
  pullRequestStateLabel,
} from "@/domains/missions/mission-labels";

/**
 * Stap 19 — de stand van de pull request en de CI, in de app zelf.
 *
 * WAAROM DIT BESTAAT
 *
 * Alles wat hier staat wist de Matrix allang: `planMissionRepair` leest de
 * CI-status vóór elke Director-beslissing, QA vergelijkt de branch met de
 * standaardbranch, en de bewijslaag haalt de gewijzigde bestanden op. Alleen
 * kwam er niets van bij de eigenaar terecht.
 *
 * Op 15 september 2026 kostte dat een avond. Een missie liep vast, en de enige
 * manier om te zien waaróm was: naar GitHub Actions, de juiste run aanklikken,
 * de job openklappen en de JSON onderaan een curl-logboek lezen. Twee keer was
 * de reden iets wat hier in één regel staat — "loopt een commit achter op de
 * standaardbranch".
 *
 * DRIE KEUZES
 *
 * Het laadt apart van de missie. Vier GitHub-aanroepen zijn te duur om aan elke
 * missie-ophaal te hangen, en het paneel haalt de missie na elke handeling
 * opnieuw op.
 *
 * Het ververst niet vanzelf. Een CI-controle duurt minuten; automatisch pollen
 * zou een vaste stroom GitHub-aanroepen opleveren voor informatie waar meestal
 * niemand naar kijkt. Vandaar één knop, plus de ouderdom van het beeld erbij —
 * zodat zichtbaar is dat je naar iets van vijf minuten geleden kijkt.
 *
 * Het gaat nooit vóór de missie staan. Mislukt het ophalen, dan staat er één
 * regel en verder niets. Dit is een spiegel, geen blokkade.
 */

function formatAge(checkedAt: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(checkedAt).getTime()) / 1000));

  if (seconds < 60) return "zojuist opgehaald";

  const minutes = Math.round(seconds / 60);

  return minutes === 1 ? "1 minuut geleden opgehaald" : `${minutes} minuten geleden opgehaald`;
}

export function MissionPullRequestCard() {
  const { user } = useAuth();
  const { mission } = useMissionEngine();

  const [status, setStatus] = useState<MissionPullRequestStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const missionId = mission?.missionId ?? null;

  // De missiestatus zit hierin verwerkt: gaat een missie van WACHT_OP_ROL naar
  // ACTIEF, dan is er net iets gebeurd en klopt het oude beeld niet meer.
  const refreshKey = `${missionId ?? ""}:${mission?.status ?? ""}:${mission?.version ?? ""}`;

  const load = useCallback(async () => {
    if (!user || !missionId) return;

    setLoading(true);
    setFailed(false);

    try {
      setStatus(await getMissionPullRequestStatusV2(user, missionId));
    } catch {
      // Wát er bij GitHub misging staat in het serverlogboek; hier is de enige
      // bruikbare boodschap "probeer het nog eens".
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [missionId, user]);

  useEffect(() => {
    setStatus(null);
    void load();
  }, [load, refreshKey]);

  if (!mission) return null;

  const attention = status ? needsAttention(status) : false;
  const behind = status ? behindByLabel(status.behindBy) : "";

  return (
    <article className="knowledge-card">
      <strong>
        Pull request &amp; CI
        {attention && <span className="mev2-pr-attention"> — vraagt aandacht</span>}
      </strong>

      {failed && <p className="muted">De stand kon niet bij GitHub worden opgehaald.</p>}

      {!failed && !status && (
        <p className="muted">
          {loading
            ? "Stand wordt opgehaald..."
            : "Nog geen pull request voor deze missie. Die komt er zodra de Builder zijn eerste wijziging heeft geschreven."}
        </p>
      )}

      {status && (
        <>
          <p className="mev2-pr-head">
            <a href={status.url} rel="noreferrer" target="_blank">
              #{status.number}
            </a>{" "}
            · {pullRequestStateLabel(status.state)} · {status.title}
          </p>

          <p className={`mev2-pr-ci mev2-pr-ci--${status.ci?.state ?? "unknown"}`}>
            {ciStatusLabel(status.ci)}
          </p>

          {behind && <p className="mev2-pr-behind">{behind}</p>}

          {status.changedFilePaths.length > 0 && (
            <ul className="mev2-pr-files">
              {status.changedFilePaths.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          )}

          <small className="muted">{formatAge(status.checkedAt)}</small>
        </>
      )}

      <button
        className="secondary"
        disabled={loading || !user}
        onClick={() => void load()}
        type="button"
      >
        {loading ? "Ophalen..." : "Ververs"}
      </button>
    </article>
  );
}
