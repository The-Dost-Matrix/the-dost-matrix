"use client";

import { useMissionEngine } from "@/domains/missions/mission-engine-store";
import { formatMissionCost, missionStatusLabel } from "@/domains/missions/mission-labels";

import "@/components/workspace/mission-engine/mission-panels.css";

/**
 * Paneel "Director & uitvoering": de geselecteerde missie, de beslissing van
 * de Director, de gebruikte kennis, het resultaat van de laatst uitgevoerde
 * rol, en de bedieningsknoppen.
 *
 * De knoppen staan onderaan het paneel: "volgende stap" als hoofdactie,
 * "Goedkeuring & Mergen" alleen wanneer de Director die specifiek heeft
 * gevraagd (gestructureerde foutcode, geen tekstherkenning), en "annuleren"
 * bewust als minder prominente uitzondering.
 */
export function MissionExecutionPanel() {
  const {
    mission,
    loadingMissions,
    busy,
    error,
    roleOutput,
    directorReason,
    usedKnowledge,
    needsApproval,
    approveInfo,
    canAutoStep,
    canCancel,
    autoStep,
    approveAndMerge,
    cancelMission,
  } = useMissionEngine();

  return (
    <section className="panel dm-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">DIRECTOR &amp; UITVOERING</p>
          <h3>Voortgang</h3>
        </div>

        {mission && <span className="badge">{missionStatusLabel(mission.status)}</span>}
      </div>

      <div className="dm-panel-body dm-scroll">
        {loadingMissions ? (
          <div className="empty">Missies worden geladen...</div>
        ) : !mission ? (
          <div className="empty">Nog geen missie aangemaakt.</div>
        ) : (
          <div className="mission-list">
            <article className="mission-card">
              <div>
                <span className="mission-status">{missionStatusLabel(mission.status)}</span>
                <p>{mission.title}</p>
                <p className="mission-objective">{mission.objective}</p>
              </div>

              <div className="mev2-card-meta">
                <small>
                  versie {mission.version} · {mission.assignments.length} toewijzing(en)
                </small>

                {mission.riskLevel !== "LOW" && (
                  <small className="mev2-risk">
                    Risiconiveau: {mission.riskLevel} (altijd jouw goedkeuring vóór mergen)
                  </small>
                )}

                <small className="mev2-cost">{formatMissionCost(mission)}</small>
              </div>
            </article>

            {!canAutoStep && mission.status !== "COMPLETED" && (
              <p className="muted">
                De Director kan hier nog niet automatisch mee verder (status:{" "}
                {missionStatusLabel(mission.status)}).
              </p>
            )}

            {mission.status === "COMPLETED" && <p className="muted">Deze missie is voltooid.</p>}

            {approveInfo && (
              <article className="knowledge-card">
                <strong>Goedkeuring &amp; Mergen</strong>
                <p>{approveInfo}</p>
              </article>
            )}

            {directorReason && (
              <article className="knowledge-card">
                <strong>Beslissing van de Director</strong>
                <p>{directorReason}</p>
              </article>
            )}

            {usedKnowledge.length > 0 && (
              <article className="knowledge-card">
                <strong>Gebruikte kennis uit het Second Brain</strong>
                <ul>
                  {usedKnowledge.map((entry) => (
                    <li key={entry.id}>{entry.title?.trim() || "(zonder titel)"}</li>
                  ))}
                </ul>
              </article>
            )}

            {roleOutput && (
              <article className="knowledge-card">
                <strong>Resultaat van de laatst uitgevoerde rol</strong>
                <p>{roleOutput}</p>
              </article>
            )}
          </div>
        )}
      </div>

      {mission && (
        <div className="dm-panel-actions">
          <button
            className="primary"
            type="button"
            disabled={!canAutoStep || busy !== null}
            onClick={() => void autoStep()}
          >
            {busy === "auto-step"
              ? "Director is bezig..."
              : "Laat de Director de volgende stap zetten"}
          </button>

          {needsApproval && (
            <button
              className="secondary"
              type="button"
              disabled={busy !== null}
              onClick={() => void approveAndMerge()}
            >
              {busy === "approve" ? "Bezig met mergen..." : "Goedkeuring & Mergen"}
            </button>
          )}

          {canCancel && (
            <button
              className="secondary"
              type="button"
              disabled={busy !== null}
              onClick={() => void cancelMission()}
            >
              {busy === "cancel" ? "Bezig..." : "Missie annuleren"}
            </button>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
