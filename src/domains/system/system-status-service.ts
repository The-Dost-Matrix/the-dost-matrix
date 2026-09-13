"use client";

import { useCallback, useEffect, useState } from "react";

import { summarizeStatusLevel, type SystemStatusReport } from "@/core/system/system-status";
import { useAuth } from "@/domains/auth/auth-provider";

export async function fetchSystemStatus(idToken: string): Promise<SystemStatusReport> {
  const response = await fetch("/api/system/status", {
    headers: { authorization: `Bearer ${idToken}` },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "De systeemstatus kon niet worden opgehaald.");
  }

  return (await response.json()) as SystemStatusReport;
}

export interface SystemStatusState {
  report: SystemStatusReport | null;
  loading: boolean;
  error: string | null;
}

export interface SystemStatusHookResult extends SystemStatusState {
  /**
   * Haalt de status opnieuw op. Toegevoegd bij stap 24: nadat je in het
   * Systeemstatus-paneel van provider wisselt, moet datzelfde paneel de nieuwe
   * keuze kunnen tonen zonder dat je de pagina herlaadt — anders staat er nog
   * seconden lang de oude provider, en dat is precies het soort scherm dat je
   * niet meer vertrouwt.
   */
  refresh: () => void;
}

/**
 * Eén gedeelde bron voor de zijbalk en het monitorpaneel. Bewust geen
 * automatische verversing per seconde: de status verandert alleen wanneer de
 * configuratie of GitHub-bereikbaarheid verandert, en een live GitHub-aanroep
 * per seconde zou onnodig quota kosten.
 */
export function useSystemStatus(): SystemStatusHookResult {
  const { user } = useAuth();
  const [state, setState] = useState<SystemStatusState>({
    report: null,
    loading: true,
    error: null,
  });

  // Een teller in plaats van de ophaalfunctie zelf als effect-dependency: zo
  // blijft het opruimen van een lopende aanvraag (de `cancelled`-vlag
  // hieronder) op één plek staan, en kan `refresh` niets anders doen dan het
  // effect opnieuw laten lopen.
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => {
    setReloadToken((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!user) {
      setState({ report: null, loading: false, error: null });
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const idToken = await user.getIdToken();
        const report = await fetchSystemStatus(idToken);
        if (!cancelled) setState({ report, loading: false, error: null });
      } catch (error) {
        if (!cancelled) {
          setState({
            report: null,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, reloadToken]);

  return { ...state, refresh };
}

/**
 * Eén samenvattend niveau voor de topbar. "UNKNOWN" tijdens het ophalen, zodat
 * er geen groen wordt getoond voordat er iets is gecontroleerd.
 */
export function summarizeReportLevel(state: SystemStatusState): string {
  if (state.error) return "ERROR";
  if (!state.report) return "UNKNOWN";
  return summarizeStatusLevel(state.report.components);
}

/** Korte, mens-leesbare tekst per niveau — nooit alleen een kleur. */
export function statusLabel(level: string): string {
  switch (level) {
    case "OK":
      return "OK";
    case "DEGRADED":
      return "BEPERKT";
    case "NOT_CONFIGURED":
      return "NIET INGESTELD";
    case "ERROR":
      return "FOUT";
    case "UNKNOWN":
      return "ONBEKEND";
    default:
      return level;
  }
}

/** Icoon naast de kleur, zodat kleur nooit als enige de betekenis draagt. */
export function statusIcon(level: string): string {
  switch (level) {
    case "OK":
      return "●";
    case "DEGRADED":
      return "◐";
    case "NOT_CONFIGURED":
      return "○";
    case "ERROR":
      return "✕";
    case "UNKNOWN":
      return "◌";
    default:
      return "○";
  }
}

export function statusModifier(level: string): string {
  return `matrix-status--${level.toLowerCase().replace(/_/g, "-")}`;
}
