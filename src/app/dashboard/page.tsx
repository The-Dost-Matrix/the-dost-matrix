"use client";

import { SecondBrainPanel } from "@/components/workspace/second-brain-panel";
import { DirectorChat } from "@/components/workspace/director-chat";
import { MissionEngineV2Panel } from "@/components/workspace/mission-engine-v2-panel";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/domains/auth/auth-provider";
import { subscribeToMissions } from "@/domains/missions/mission-service";

import type { Mission } from "@/shared/types/mission";

const agents = [
  ["Headquarters", "Director", "Planning"],
  ["Forge Labs", "Builder", "Stand-by"],
  ["QA Outpost", "QA", "Monitoring"],
  ["Archive", "Chronicler", "Recording"],
];

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [missions, setMissions] = useState<Mission[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
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

  if (loading || !user) {
    return (
      <main className="center-screen">
        Matrix Core wordt geladen...
      </main>
    );
  }

  return (
    <>
      <section className="hero panel">
        <div>
          <p className="eyebrow">MATRIX CORE</p>

          <h2>Goed dat je er bent, Elroy.</h2>

          <p className="muted">
            Director, Second Brain en realtime Matrix-activiteit zijn verbonden
            in één centrale werkruimte.
          </p>
        </div>

        <div className="stats">
          <div>
            <strong>{agents.length}</strong>
            <span>Agents</span>
          </div>

          <div>
            <strong>{missions.length}</strong>
            <span>Missies</span>
          </div>

          <div>
            <strong>0</strong>
            <span>Approvals</span>
          </div>
        </div>
      </section>

      {/*
        Twee kolommen naast elkaar: chat links, Second Brain rechts (zie
        .command-center-main-grid--chat-focus in globals.css voor de
        daadwerkelijke grid-CSS). Eerder stonden SecondBrainPanel en
        DirectorChat hier gewoon onder elkaar in DOM-volgorde, met
        klassenamen ("command-center-main-grid--chat-focus",
        "command-center-left-column") die een kolomindeling al suggereerden
        maar waarvoor nooit CSS was geschreven.
      */}
      <section className="command-center-main-grid command-center-main-grid--chat-focus command-center-main-grid--without-missions">
        <div className="command-center-left-column">
          <DirectorChat />
        </div>

        <div className="command-center-right-column">
          <SecondBrainPanel />
        </div>
      </section>

      <MissionEngineV2Panel variant="compact" />

      {error && <p className="error">{error}</p>}
    </>
  );
}