"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { MissionCreatePanel } from "@/components/workspace/mission-engine/mission-create-panel";
import { MissionExecutionPanel } from "@/components/workspace/mission-engine/mission-execution-panel";
import { RecentMissionsPanel } from "@/components/workspace/mission-engine/recent-missions-panel";
import { MissionProgressPanel } from "@/components/workspace/mission-progress-panel";
import { useAuth } from "@/domains/auth/auth-provider";
import { MissionEngineProvider } from "@/domains/missions/mission-engine-store";

import "@/components/workspace/mission-engine/mission-panels.css";

/**
 * Detailweergave van de Mission Engine. Het Command Center toont de Mission
 * Engine samen met de chat in drie smalle kolommen; deze pagina toont
 * dezelfde panelen breder, met de missielijst erbij om een oudere missie
 * terug te halen.
 *
 * Dit is precies waar de opzet zonder props voor bedoeld is: exact dezelfde
 * componenten als op het Command Center, alleen anders ingedeeld. Er is geen
 * tweede versie van het formulier of van de uitvoeringslogica die uit elkaar
 * kan gaan lopen.
 */
export default function MissionsV2Page() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return <main className="center-screen">Matrix Core wordt geladen...</main>;
  }

  return (
    <MissionEngineProvider>
      <section className="dm-detail-grid">
        <MissionCreatePanel />

        <div className="dm-command-column">
          <MissionExecutionPanel />
          <MissionProgressPanel />
        </div>
      </section>

      <RecentMissionsPanel />
    </MissionEngineProvider>
  );
}
