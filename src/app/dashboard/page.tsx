"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/domains/auth/auth-provider";
import {
  createMission,
  subscribeToMissions,
} from "@/domains/missions/mission-service";
import type { Mission } from "@/shared/types/mission";

const agents = [
  ["Headquarters", "Director", "Planning"],
  ["Forge Labs", "Builder", "Stand-by"],
  ["QA Outpost", "QA", "Monitoring"],
  ["Archive", "Chronicler", "Recording"],
];

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [command, setCommand] = useState("");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;

    return subscribeToMissions(
      user.uid,
      setMissions,
      (subscriptionError) => {
        setError(
          subscriptionError.message.includes("index")
            ? "Firestore vraagt om een index. Open de link in de browserconsole of gebruik de instructie in README.md."
            : subscriptionError.message,
        );
      },
    );
  }, [user]);

  async function submitMission(event: FormEvent) {
    event.preventDefault();
    if (!user || !command.trim()) return;

    setBusy(true);
    setError("");

    try {
      await createMission(user.uid, command.trim());
      setCommand("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Missie opslaan is mislukt.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <main className="center-screen">Matrix Core wordt geladen...</main>;
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">THE DOST MATRIX · v0.2</p>
          <h1>Foundation Command Center</h1>
        </div>
        <div className="top-actions">
          <span>{user.email}</span>
          <button className="secondary" onClick={() => signOut()}>
            Uitloggen
          </button>
        </div>
      </header>

      <section className="hero panel">
        <div>
          <p className="eyebrow">MATRIX CORE</p>
          <h2>Goed dat je er bent, Elroy.</h2>
          <p className="muted">
            Geef de eerste echte opdracht. De missie wordt realtime opgeslagen
            in jouw Firestore-database en als auditgebeurtenis geregistreerd.
          </p>
        </div>
        <div className="stats">
          <div><strong>{agents.length}</strong><span>Agents</span></div>
          <div><strong>{missions.length}</strong><span>Missies</span></div>
          <div><strong>0</strong><span>Approvals</span></div>
        </div>
      </section>

      <section className="main-grid">
        <div className="panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">VISUAL ORGANIZATION</p>
              <h3>Matrix City</h3>
            </div>
            <span className="badge">ONLINE</span>
          </div>

          <div className="agent-grid">
            {agents.map(([building, agent, status]) => (
              <article className="agent-card" key={building}>
                <span className="agent-symbol">◆</span>
                <h4>{building}</h4>
                <p>{agent} Agent</p>
                <small>{status}</small>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <p className="eyebrow">MISSION CONSOLE</p>
          <h3>Opdracht aan Matrix Core</h3>
          <form onSubmit={submitMission} className="stack">
            <textarea
              rows={7}
              placeholder='Bijvoorbeeld: "Maak een herbruikbare Terms of Use-module voor de Heat Input Calculator."'
              value={command}
              onChange={(event) => setCommand(event.target.value)}
            />
            <button className="primary" disabled={busy || !command.trim()}>
              {busy ? "Missie wordt vastgelegd..." : "Maak Director-plan"}
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">REALTIME FIRESTORE</p>
            <h3>Mission Center</h3>
          </div>
          <span className="badge">{missions.length} MISSIES</span>
        </div>

        <div className="mission-list">
          {missions.length === 0 ? (
            <div className="empty">Nog geen missie. Matrix Core wacht op jouw eerste opdracht.</div>
          ) : (
            missions.map((mission) => (
              <article className="mission-card" key={mission.id}>
                <div>
                  <span className="mission-status">{mission.status}</span>
                  <p>{mission.command}</p>
                </div>
                <small>
                  {mission.createdAt
                    ? mission.createdAt.toLocaleString("nl-NL")
                    : "Wordt opgeslagen..."}
                </small>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
