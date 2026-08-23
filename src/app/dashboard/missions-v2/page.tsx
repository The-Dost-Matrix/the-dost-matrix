"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/domains/auth/auth-provider";
import {
  autoStepMissionV2,
  createMissionV2,
} from "@/domains/missions/mission-engine-v2-service";
import type { MissionV2 } from "@/core/mission-engine/v2/mission";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

/**
 * Eerste werkende scherm voor Mission Engine V2: hier kun je een mission
 * aanmaken en de Director zelf laten beslissen wat de eerstvolgende stap is
 * — inclusief het écht laten uitvoeren van die stap door de builder-rol
 * (een echte LLM-aanroep). Dit is bewust een dun testscherm, geen
 * eindontwerp — het bestaat om zichtbaar en klikbaar te maken dat de motor
 * nu écht werkt, met echte opslag en een zelfstandige beslisser.
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

export default function MissionsV2Page() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [successCriteriaText, setSuccessCriteriaText] = useState("");

  const [mission, setMission] = useState<MissionV2 | null>(null);
  const [roleOutput, setRoleOutput] = useState("");
  const [directorReason, setDirectorReason] = useState("");
  const [usedKnowledge, setUsedKnowledge] = useState<KnowledgeEntry[]>([]);

  const [busy, setBusy] = useState<"create" | "auto-step" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return <main className="center-screen">Matrix Core wordt geladen...</main>;
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
    setRoleOutput("");
    setDirectorReason("");
    setUsedKnowledge([]);

    try {
      const created = await createMissionV2(user, {
        title: title.trim(),
        objective: objective.trim(),
        successCriteria,
      });
      setMission(created);
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
    <main className="dashboard-shell">
      <section className="panel command-center-intro">
        <div>
          <p className="eyebrow">MISSION ENGINE V2</p>
          <h1>Mission Engine — zelfstandige Director</h1>
          <p className="muted">
            Missies worden echt opgeslagen (Firestore). Eén knop laat de
            Director zelf beslissen wat de eerstvolgende stap is — en voert
            die (bij een dispatch naar de builder-rol) meteen ook uit via een
            echte LLM-aanroep. Jij hoeft alleen nog op de knop te klikken
            totdat de missie voltooid is. De Director gebruikt daarbij ook
            goedgekeurde kennis uit je Second Brain als achtergrond.
          </p>
        </div>
      </section>

      <section className="command-center-main-grid">
        <div className="panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">STAP 1</p>
              <h3>Nieuwe mission</h3>
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
              <p className="eyebrow">STAP 2</p>
              <h3>Director &amp; uitvoering</h3>
            </div>

            {mission && <span className="badge">{statusLabel(mission.status)}</span>}
          </div>

          {!mission ? (
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
                  {statusLabel(mission.status)}). Dit soort situaties oplossen is
                  nog niet gebouwd in dit testscherm.
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
    </main>
  );
}
