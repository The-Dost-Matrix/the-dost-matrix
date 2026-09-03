"use client";

import { SecondBrainPanel } from "@/components/workspace/second-brain-panel";
import { DirectorChat } from "@/components/workspace/director-chat";
import { MissionEngineV2Panel } from "@/components/workspace/mission-engine-v2-panel";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/domains/auth/auth-provider";
import { subscribeToMissions } from "@/domains/missions/mission-service";

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;

    // De missies zelf worden hier niet meer bijgehouden (geen weergave meer
    // van dat aantal op deze pagina — zie Topbar, die zijn eigen live
    // subscription al had voor de mission-ticker en nu ook de "Missies"-
    // teller voedt). Deze subscription blijft alleen bestaan om dezelfde
    // Firestore-indexfout hieronder te blijven signaleren.
    return subscribeToMissions(
      user.uid,
      () => {},
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
      {/*
        De voormalige "MATRIX CORE"-hero (eyebrow, titel, muted intro-tekst
        en de Agents/Missies/Approvals-tellers) stond hier. Op eigen verzoek
        verwijderd: de drie tellers zijn verhuisd naar de topbar (zie
        Topbar in components/layout/topbar.tsx, .matrix-topbar-stats), waar
        ze op elke /dashboard-pagina zichtbaar zijn in plaats van alleen
        hier. De rest van de hero (welkomsttekst) had geen functionele rol
        en is niet elders teruggeplaatst.
      */}

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