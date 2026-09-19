"use client";

import { MissionAgentActivityCard } from "@/components/workspace/mission-engine/mission-agent-activity-card";
import { MissionPullRequestCard } from "@/components/workspace/mission-engine/mission-pull-request-card";
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
 *
 * Stap 12b: staat de missie op WAITING_FOR_OWNER, dan toont dit paneel de
 * openstaande vraag van de Director (mission.pendingOwnerInput) met een
 * antwoordformulier. Ging de vraag over een specifiek succescriterium
 * (relatedCriterionId gezet), dan is een keuze uit "gehaald"/"niet gehaald"
 * verplicht — bij een generiek verzoek volstaat alleen een reden. Dit sluit
 * de tot nu toe dode WAITING_FOR_OWNER-lus: engine.recordOwnerInput() bestond
 * al, maar had geen aanroeper.
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
    ownerInputResponse,
    setOwnerInputResponse,
    ownerInputOutcome,
    setOwnerInputOutcome,
    answerOwnerInput,
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

            {mission.status === "WAITING_FOR_OWNER" && mission.pendingOwnerInput && (
              <article className="knowledge-card">
                <strong>De Director heeft een vraag voor je</strong>
                <p className="mev2-owner-question">{mission.pendingOwnerInput.question}</p>

                {mission.pendingOwnerInput.relatedCriterionId && (
                  <div className="mev2-owner-outcome-choice">
                    <label>
                      <input
                        type="radio"
                        name="owner-input-outcome"
                        checked={ownerInputOutcome === "PASSED"}
                        onChange={() => setOwnerInputOutcome("PASSED")}
                      />
                      Gehaald
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="owner-input-outcome"
                        checked={ownerInputOutcome === "FAILED"}
                        onChange={() => setOwnerInputOutcome("FAILED")}
                      />
                      Niet gehaald
                    </label>
                  </div>
                )}

                <textarea
                  className="mev2-owner-response"
                  rows={3}
                  placeholder="Korte reden bij je antwoord..."
                  value={ownerInputResponse}
                  onChange={(event) => setOwnerInputResponse(event.target.value)}
                />

                <button
                  className="primary"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void answerOwnerInput()}
                >
                  {busy === "answer-owner" ? "Bezig..." : "Antwoord versturen"}
                </button>
              </article>
            )}

            {/* Stap 19: bewust vlak onder de vraag van de Director en boven
                zijn beslissing. Loopt een missie vast, dan staat de reden
                meestal hier — en niet in de motivering eronder. */}
            <MissionPullRequestCard />

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

            {/* Stap 22, onderdeel 3: toont zichzelf alleen wanneer er
                daadwerkelijk iets namens de eigenaar is beantwoord. */}
            <MissionAgentActivityCard mission={mission} />
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
