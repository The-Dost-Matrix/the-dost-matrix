"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/domains/auth/auth-provider";
import { MatrixEventStream } from "@/components/workspace/matrix-event-stream";
import {
  SystemMonitorPanel,
} from "@/components/monitor/system-monitor";
import {
  statusIcon,
  statusLabel,
  statusModifier,
  summarizeReportLevel,
  useSystemStatus,
} from "@/domains/system/system-status-service";
import { subscribeToMissions } from "@/domains/missions/mission-service";

import type { Mission } from "@/shared/types/mission";

/**
 * Topbar zonder de "ACTIVE MISSIONS" / "LIVE MATRIX" tickers: die scrollende
 * balken renderden niet meer correct (geen bruikbare scroll-animatie meer,
 * platte tekst die overliep) en zijn op verzoek van de eigenaar volledig
 * verwijderd, samen met de data-subscriptions (missies, chatberichten,
 * kennis) die uitsluitend voor die tickers bestonden.
 *
 * De rechter sidebar van het Command Center (Recent Activity, System
 * Monitor) is vervangen door uitklapbare knoppen hier in de topbar. Het
 * paneel "Active Agents" is verwijderd: het toonde vier vaste kaarten met
 * verzonnen statussen (waaronder een Builder die als "niet verbonden" stond
 * terwijl hij al maanden werkt). De onderliggende Firestore-gedreven componenten
 * (`MatrixEventStream`, `SystemMonitorPanel`) zijn
 * hergebruikt en worden nu getoond in een uitklapbaar paneel in plaats van
 * een vaste sidebar. `command-center-layout.tsx` heeft daardoor geen
 * `monitor`-prop meer nodig, en `dashboard/layout.tsx` geeft die ook niet
 * meer door.
 *
 * De losse `missions`-subscription hieronder is een NIEUWE, kleine
 * toevoeging (los van de sanering hierboven): puur om de "Missies"-teller
 * hieronder te voeden, zonder ticker of scroll-animatie — dus geen
 * tegenspraak met de reden waarom de tickers destijds verwijderd zijn.
 */
type TopbarDropdownId = "activity" | "system";

/**
 * De tellers "AGENTS" en "APPROVALS" stonden hier eerder als vaste getallen
 * (4 en 0) omdat er geen live bron voor bestond. Ze zijn verwijderd in plaats
 * van blijven staan: een scherm hoort niets te tellen wat het niet echt kan
 * tellen. Het aantal missies hieronder komt wél uit een echte subscription.
 */
const DROPDOWN_TOOLS: Array<{
  id: TopbarDropdownId;
  label: string;
  icon: string;
}> = [
  { id: "activity", label: "Recent Activity", icon: "◷" },
  { id: "system", label: "Systeemstatus", icon: "▤" },
];

export function Topbar() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [openDropdown, setOpenDropdown] = useState<TopbarDropdownId | null>(
    null,
  );
  const [missions, setMissions] = useState<Mission[]>([]);
  const systemStatus = useSystemStatus();
  const summaryLevel = summarizeReportLevel(systemStatus);

  const toolsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user) return;

    return subscribeToMissions(user.uid, setMissions, () => {});
  }, [user]);

  useEffect(() => {
    if (!openDropdown) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (
        toolsRef.current &&
        !toolsRef.current.contains(event.target as Node)
      ) {
        setOpenDropdown(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenDropdown(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openDropdown]);

  function toggleDropdown(id: TopbarDropdownId) {
    setOpenDropdown((current) => (current === id ? null : id));
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <header className="matrix-topbar">
      <div className="matrix-topbar-main">
        <div className="matrix-command-search">
          <span>⌕</span>

          <input
            aria-label="Zoeken in The Dost Matrix"
            placeholder="Search anything in your Matrix..."
            type="search"
          />

          <kbd>Ctrl K</kbd>
        </div>

        <div className="matrix-topbar-actions">
          {/*
            Verhuisd vanuit de voormalige MATRIX CORE-hero op het Command
            Center (die hero-sectie is daar verwijderd, zie dashboard/
            page.tsx) — nu zichtbaar op elke /dashboard-pagina in plaats van
            alleen daar.
          */}
          <div className="matrix-topbar-stats">
            <div className="matrix-topbar-stat">
              <strong>{missions.length}</strong>
              <span>MISSIES</span>
            </div>
          </div>

          {/*
            Stond hier eerder als vaste tekst "SYSTEM STATUS / OPERATIONAL",
            ongeacht of er ook maar iets werkte. Komt nu uit
            /api/system/status — zie system-status.ts voor wat er precies
            gecontroleerd wordt en hoe.
          */}
          <div className={`matrix-system-status ${statusModifier(summaryLevel)}`}>
            <span aria-hidden="true" className="matrix-status-glyph">
              {statusIcon(summaryLevel)}
            </span>

            <div>
              <small>SYSTEEMSTATUS</small>
              <strong>{systemStatus.loading ? "CONTROLEREN" : statusLabel(summaryLevel)}</strong>
            </div>
          </div>

          <div className="matrix-topbar-tools" ref={toolsRef}>
            {DROPDOWN_TOOLS.map((tool) => (
              <div className="matrix-topbar-tool" key={tool.id}>
                <button
                  aria-expanded={openDropdown === tool.id}
                  aria-haspopup="true"
                  aria-label={tool.label}
                  className={
                    openDropdown === tool.id
                      ? "matrix-topbar-tool-button matrix-topbar-tool-button--active"
                      : "matrix-topbar-tool-button"
                  }
                  onClick={() => toggleDropdown(tool.id)}
                  type="button"
                >
                  <span className="matrix-topbar-tool-icon">{tool.icon}</span>
                  <span className="matrix-topbar-tool-label">
                    {tool.label}
                  </span>
                </button>

                {openDropdown === tool.id ? (
                  <div
                    aria-label={tool.label}
                    className="matrix-topbar-tool-panel"
                    role="dialog"
                  >
                    <div className="matrix-topbar-tool-panel-header">
                      <strong>{tool.label}</strong>
                    </div>

                    <div className="matrix-topbar-tool-panel-body">
                      {tool.id === "activity" && (
                        <MatrixEventStream variant="dropdown" />
                      )}
                      {tool.id === "system" && <SystemMonitorPanel />}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <button
            aria-label="Terminal"
            className="matrix-icon-button"
            disabled
            type="button"
          >
            &gt;_
          </button>

          <button
            aria-label="Meldingen"
            className="matrix-icon-button"
            disabled
            type="button"
          >
            ♧
          </button>

          <button
            aria-label="Instellingen"
            className="matrix-icon-button"
            disabled
            type="button"
          >
            ⚙
          </button>

          <div className="matrix-profile">
            <div className="matrix-profile-avatar">
              {(user?.email?.[0] ?? "E").toUpperCase()}
            </div>

            <div className="matrix-profile-details">
              <strong>Elroy</strong>
              <span>Owner</span>
            </div>

            <button
              className="matrix-profile-signout"
              onClick={() => void handleSignOut()}
              type="button"
            >
              Uitloggen
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
