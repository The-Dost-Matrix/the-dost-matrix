"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/domains/auth/auth-provider";
import { MissionEngineV2Panel } from "@/components/workspace/mission-engine-v2-panel";

/**
 * Standalone pagina voor Mission Engine V2. Sinds Mission Engine V2 ook een
 * vaste plek heeft op het hoofdscherm (Command Center), is dit nu alleen nog
 * een dunne auth-wrapper rond dezelfde MissionEngineV2Panel-component — geen
 * losse logica meer om uit elkaar te laten lopen.
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
    <main className="dashboard-shell">
      <MissionEngineV2Panel />
    </main>
  );
}
