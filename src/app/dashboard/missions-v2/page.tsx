"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/domains/auth/auth-provider";
import {
  createMissionV2,
  dispatchMissionV2,
  runMissionRoleV2,
} from "@/domains/missions/mission-engine-v2-service";
import type { MissionV2 } from "@/core/mission-engine/v2/mission";

/**
 * Eerste werkende scherm voor Mission Engine V2: hier kun je een mission
 * aanmaken, hem laten oppakken door de (nog handmatig ingezette) builder-rol,
 * en die rol daadwerkelijk laten uitvoeren via de LLM-provider. Dit is
 * bewust een dun testscherm, geen eindontwerp — het bestaat om zichtbaar en
 * klikbaar te maken dat de motor nu écht werkt, met echte opslag.
 */

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

  const [busy, setBusy] = useState<"create" | "dispatch" | "run-role" | null>(null);
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

  async function handleDispatch() {
    if (!user || !mission) return;

    setBusy("dispatch");
    setError("");

    try {
      const updated = await dispatchMissionV2(user, mission.missionId);
      setMission(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Dispatch is mislukt.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRunRole() {
    if (!user || !mission) return;

    setBusy("run-role");
    setError("");

    try {
      const result = await runMissionRoleV2(user, mission.missionId);
      setMission(result.mission);
      setRoleOutput(result.roleOutput);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rol uitvoeren is mislukt.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="dashboard-shell">
      <section className="panel command-center-intro">
        <div>
          <p className="eyebrow">MISSION ENGINE V2</p>
          <h1>Mission Engine — eerste werkende versie</h1>
          <p className="muted">
            Missies hier worden echt opgeslagen (Firestore) en de
            builder-rol roept écht een LLM aan. Dispatch gebeurt voorlopig
            handmatig via de knop hieronder — een zelfstandige Director-rol
            die dat automatisch beslist volgt later.
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
              <p className="eyebrow">STAP 2 &amp; 3</p>
              <h3>Status &amp; uitvoering</h3>
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
                  className="secondary"
                  type="button"
                  disabled={mission.status !== "ACTIVE" || busy !== null}
                  onClick={() => void handleDispatch()}
                >
                  {busy === "dispatch" ? "Bezig..." : "Dispatch naar builder-rol"}
                </button>

                <button
                  className="primary"
                  type="button"
                  disabled={mission.status !== "WAITING_FOR_ROLE" || busy !== null}
                  onClick={() => void handleRunRole()}
                >
                  {busy === "run-role" ? "Bezig..." : "Voer rol uit (LLM)"}
                </button>
              </div>

              {roleOutput && (
                <article className="knowledge-card">
                  <strong>Resultaat van de rol</strong>
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
