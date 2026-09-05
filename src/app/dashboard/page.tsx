"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { DirectorChat } from "@/components/workspace/director-chat";
import { MissionCreatePanel } from "@/components/workspace/mission-engine/mission-create-panel";
import { MissionExecutionPanel } from "@/components/workspace/mission-engine/mission-execution-panel";
import { MissionProgressPanel } from "@/components/workspace/mission-progress-panel";
import { useAuth } from "@/domains/auth/auth-provider";
import { MissionEngineProvider } from "@/domains/missions/mission-engine-store";
import { subscribeToMissions } from "@/domains/missions/mission-service";

import "@/components/workspace/mission-engine/mission-panels.css";

/**
 * Command Center — drie kolommen naast elkaar, van links naar rechts:
 * chat met de Director, de Mission Engine, en de statuskolom met daarin
 * "Director & uitvoering" boven en "Missievoortgang" eronder.
 *
 * De pagina is nu niet meer dan een indeling: elk paneel haalt zijn eigen
 * gegevens uit MissionEngineProvider. Een paneel naar een andere kolom
 * verplaatsen is daardoor één regel JSX verzetten — zie mission-panels.css
 * voor de kolombreedtes.
 *
 * Het Second Brain-paneel met de 3D-bol stond hier eerder rechts; op verzoek
 * van de eigenaar verwijderd. De component second-brain-panel.tsx blijft
 * bestaan maar wordt nergens meer gebruikt: Second Brain krijgt een eigen
 * plek zodra de doorzoekbare weergave uit stap 18 er is.
 *
 * Het Dost Council-paneel uit het functioneel ontwerp staat hier bewust nog
 * niet: de Council bestaat nog niet (stap 13). Zodra die er is, wordt het
 * hele ontwerp van deze pagina opnieuw bekeken.
 */
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

    // De missies zelf worden hier niet bijgehouden (de panelen hebben hun
    // eigen bron via MissionEngineProvider). Deze subscription blijft alleen
    // bestaan om een ontbrekende Firestore-index te blijven signaleren —
    // zonder dit is die fout nergens in de UI zichtbaar.
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
    return <main className="center-screen">Matrix Core wordt geladen...</main>;
  }

  return (
    <MissionEngineProvider>
      <section className="dm-command-grid">
        <DirectorChat />

        <MissionCreatePanel />

        <div className="dm-command-column">
          <MissionExecutionPanel />
          <MissionProgressPanel />
        </div>
      </section>

      {error && <p className="error">{error}</p>}
    </MissionEngineProvider>
  );
}
