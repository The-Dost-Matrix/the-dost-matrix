"use client";

import { FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/domains/auth/auth-provider";
import {
  autoStepMissionV2,
  createMissionV2,
  listMissionsV2,
} from "@/domains/missions/mission-engine-v2-service";
import type { MissionV2 } from "@/core/mission-engine/v2/mission";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

/**
 * Mission Engine V2: hier kun je een mission aanmaken en de Director zelf
 * laten beslissen wat de eerstvolgende stap is — inclusief het écht laten
 * uitvoeren van die stap door de builder-rol (een echte LLM-aanroep), met
 * gebruik van goedgekeurde kennis uit het Second Brain als achtergrond.
 *
 * Losgetrokken uit de oorspronkelijke testpagina (/dashboard/missions-v2) tot
 * een herbruikbaar paneel, zodat Mission Engine V2 nu een vaste plek heeft op
 * het hoofdscherm (Command Center) én de standalone pagina blijft werken —
 * beide renderen exact dezelfde component, geen losse logica om uit elkaar te
 * laten lopen.
 */

const AUTO_STEP_STATUSES: MissionV2["status"][] = ["ACTIVE", "WAITING_FOR_ROLE"];

function statusLabel(status: MissionV2["status"]): string {
  const labels: Record<MissionV2["status"], string> = {
    DRAFT: "Concept",
    READY: "Klaar om te starten",
    ACTIVE: "Actief",
    WAITING_FOR_ROLE: "Wacht op rol-uitvoering",
    WAITING_FOR_OWNER: "Wacht op jouw input",
    WAITING_FOR_APPROVAL: "Wacht op jouw goedkeuring",
    REPLANNING: "Wordt herpland",
    PAUSED: "Gepauzeerd",
    COMPLETED: "Voltooid",
    FAILED: "Mislukt",
    CANCELLED: "Geannuleerd",
  };

  return labels[status] ?? status;
}

export function MissionEngineV2Panel() {
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [successCriteriaText, setSuccessCriteriaText] = useState("");

  const [recentMissions, setRecentMissions] = useState<MissionV2[]>([]);
  const [mission, setMission] = useState<MissionV2 | null>(null);
  const [roleOutput, setRoleOutput] = useState("");
  const [directorReason, setDirectorReason] = useState("");
  const [usedKnowledge, setUsedKnowledge] = useState<KnowledgeEntry[]>([]);

  const [busy, setBusy] = useState<"create" | "auto-step" | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      try {
        const missions = await listMissionsV2(user, 5);
        if (cancelled) return;

        setRecentMissions(missions);

        // Toon standaard de meest recent bijgewerkte missie, zodat je bij
        // terugkomst op het hoofdscherm niet elke keer opnieuw hoeft te
        // beginnen.
        if (missions.length > 0) {
          setMission(missions[0]);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Missies ophalen is mislukt.");
        }
      } finally {
        if (!cancelled) setLoadingRecent(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  function resetFeedback() {
    setRoleOutput("");
    setDirectorReason("");
    setUsedKnowledge([]);
  }

  function selectMission(candidate: MissionV2) {
    setMission(candidate);
    resetFeedback();
    setError("");
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user) return;

    const successCriteria = successCriteriaText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!title.trim() || !objective.trim() || successCriteria.length === 0) {
      setError("Vul een titel, doel en minimaal één succescriterium in.");
      return;
    }

    setBusy("create");
    setError("");
    resetFeedback();

    try {
      const created = await createMissionV2(user, {
        title: title.trim(),
        objective: objective.trim(),
        successCriteria,
      });
      setMission(created);
      setRecentMissions((current) => [created, ...current].slice(0, 5));
      setTitle("");
      setObjective("");
      setSuccessCriteriaText("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Mission aanmaken is mislukt.");
    } finally {
      setBusy(null);
    }
  }

  async function handleAutoStep() {
    if (!user || !mission) return;

    setBusy("auto-step");
    setError("");

    try {
      const result = await autoStepMissionV2(user, mission.missionId);
      setMission(result.mission);
      setRecentMissions((current) =>
        current.map((entry) => (entry.missionId === result.mission.missionId ? result.mission : entry)),
      );
      if (result.decision) setDirectorReason(result.decision.reason);
      if (result.roleOutput) setRoleOutput(result.roleOutput);
      setUsedKnowledge(result.usedKnowledge ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "De Director kon geen stap zetten.");
    } finally {
      setBusy(null);
    }
  }

  const canAutoStep = mission && AUTO_STEP_STATUSES.includes(mission.status);

  return (
    <>
      <section className="panel command-center-intro">
        <div>
          <p className="eyebrow">MISSION ENGINE V2</p>
          <h1>Mission Engine — zelfstandige Director</h1>
          <p className="muted">
            Missies worden echt opgeslagen (Firestore). Eén knop laat de
            Director zelf beslissen wat de eerstvolgende stap is — en voert
            die (bij een dispatch naar de builder-rol) meteen ook uit via een
            echte LLM-aanroep. De Director gebruikt daarbij ook goedgekeurde
            kennis uit je Second Brain als achtergrond.
          </p>
        </div>
      </section>

      {recentMissions.length > 1 && (
        <section className="panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">RECENTE MISSIES</p>
              <h3>Kies een missie</h3>
            </div>
          </div>

          <div className="mission-list">
            {recentMissions.map((candidate) => (
              <button
                key={candidate.missionId}
                type="button"
                className={
                  mission?.missionId === candidate.missionId ? "mission-card mission-card--active" : "mission-card"
                }
                onClick={() => selectMission(candidate)}
              >
                <span className="mission-status">{statusLabel(candidate.status)}</span>
                <p>{candidate.title}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="command-center-main-grid">
        <div className="panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">NIEUWE MISSION</p>
              <h3>Aanmaken</h3>
            </div>
          </div>

          <form className="command-center-quick-command" onSubmit={submitCreate}>
            <input
              placeholder="Titel"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />

            <input
              placeholder="Doel (wat moet er bereikt worden?)"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
            />

            <textarea
              rows={3}
              placeholder={"Succescriteria, één per regel"}
              value={successCriteriaText}
              onChange={(event) => setSuccessCriteriaText(event.target.value)}
            />

            <button className="primary" disabled={busy === "create"}>
              {busy === "create" ? "Bezig..." : "Mission aanmaken en starten"}
            </button>
          </form>
        </div>

        <div className="panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">DIRECTOR &amp; UITVOERING</p>
              <h3>Voortgang</h3>
            </div>

            {mission && <span className="badge">{statusLabel(mission.status)}</span>}
          </div>

          {loadingRecent ? (
            <div className="empty">Missies worden geladen...</div>
          ) : !mission ? (
            <div className="empty">Nog geen mission aangemaakt.</div>
          ) : (
            <div className="mission-list">
              <article className="mission-card">
                <div>
                  <span className="mission-status">{statusLabel(mission.status)}</span>
                  <p>{mission.title}</p>
                  <small>{mission.objective}</small>
                </div>

                <small>
                  versie {mission.version} · {mission.assignments.length} toewijzing(en)
                </small>
              </article>

              <div className="command-center-quick-command">
                <button
                  className="primary"
                  type="button"
                  disabled={!canAutoStep || busy !== null}
                  onClick={() => void handleAutoStep()}
                >
                  {busy === "auto-step"
                    ? "Director is bezig..."
                    : "Laat de Director de volgende stap zetten"}
                </button>
              </div>

              {!canAutoStep && mission.status !== "COMPLETED" && (
                <p className="muted">
                  De Director kan hier nog niet automatisch mee verder (status:{" "}
                  {statusLabel(mission.status)}).
                </p>
              )}

              {mission.status === "COMPLETED" && (
                <p className="muted">Deze missie is voltooid.</p>
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
                  <strong>Resultaat van de builder-rol</strong>
                  <p>{roleOutput}</p>
                </article>
              )}
            </div>
          )}
        </div>
      </section>

      {error && <p className="error">{error}</p>}
    </>
  );
}
