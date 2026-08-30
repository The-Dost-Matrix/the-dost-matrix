"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/domains/auth/auth-provider";
import { MatrixEventStream } from "@/components/workspace/matrix-event-stream";
import {
  ActiveAgents,
  SystemMonitorStatus,
} from "@/components/monitor/system-monitor";

/**
 * Topbar zonder de "ACTIVE MISSIONS" / "LIVE MATRIX" tickers: die scrollende
 * balken renderden niet meer correct (geen bruikbare scroll-animatie meer,
 * platte tekst die overliep) en zijn op verzoek van de eigenaar volledig
 * verwijderd, samen met de data-subscriptions (missies, chatberichten,
 * kennis) die uitsluitend voor die tickers bestonden.
 *
 * De rechter sidebar van het Command Center (Recent Activity, System
 * Monitor, Active Agents) is vervangen door drie uitklapbare knoppen hier in
 * de topbar. De onderliggende Firestore-gedreven componenten
 * (`MatrixEventStream`, `SystemMonitorStatus`, `ActiveAgents`) zijn
 * ongewijzigd hergebruikt, alleen nu gerenderd binnen een dropdown-paneel in
 * plaats van in een vaste sidebar.
 */
type TopbarDropdownId = "activity" | "system" | "agents";

export function Topbar() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [openDropdown, setOpenDropdown] = useState<TopbarDropdownId | null>(
    null,
  );

  const toolsRef = useRef<HTMLDivElement | null>(null);

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
          <div className="matrix-system-status">
            <span className="matrix-status-dot" />

            <div>
              <small>SYSTEM STATUS</small>
              <strong>OPERATIONAL</strong>
            </div>
          </div>

          <div className="matrix-topbar-tools" ref={toolsRef}>
            <div className="matrix-topbar-tool">
              <button
                aria-expanded={openDropdown === "activity"}
                aria-haspopup="true"
                aria-label="Recent Activity"
                className="matrix-topbar-tool-button"
                onClick={() => toggleDropdown("activity")}
                type="button"
              >
                <span className="matrix-topbar-tool-icon">⏱</span>
                <span className="matrix-topbar-tool-dot" />
              </button>

              {openDropdown === "activity" ? (
                <div
                  className="matrix-topbar-tool-dropdown"
                  role="dialog"
                  aria-label="Recent Activity"
                >
                  <div className="matrix-topbar-tool-dropdown-header">
                    <strong>Recent Activity</strong>
                  </div>

                  <div className="matrix-topbar-tool-dropdown-body">
                    <MatrixEventStream />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="matrix-topbar-tool">
              <button
                aria-expanded={openDropdown === "system"}
                aria-haspopup="true"
                aria-label="System Monitor"
                className="matrix-topbar-tool-button"
                onClick={() => toggleDropdown("system")}
                type="button"
              >
                <span className="matrix-topbar-tool-icon">▣</span>
                <span className="matrix-topbar-tool-dot" />
              </button>

              {openDropdown === "system" ? (
                <div
                  className="matrix-topbar-tool-dropdown"
                  role="dialog"
                  aria-label="System Monitor"
                >
                  <div className="matrix-topbar-tool-dropdown-header">
                    <strong>System Monitor</strong>
                  </div>

                  <div className="matrix-topbar-tool-dropdown-body">
                    <SystemMonitorStatus />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="matrix-topbar-tool">
              <button
                aria-expanded={openDropdown === "agents"}
                aria-haspopup="true"
                aria-label="Active Agents"
                className="matrix-topbar-tool-button"
                onClick={() => toggleDropdown("agents")}
                type="button"
              >
                <span className="matrix-topbar-tool-icon">◈</span>
                <span className="matrix-topbar-tool-dot" />
              </button>

              {openDropdown === "agents" ? (
                <div
                  className="matrix-topbar-tool-dropdown"
                  role="dialog"
                  aria-label="Active Agents"
                >
                  <div className="matrix-topbar-tool-dropdown-header">
                    <strong>Active Agents</strong>
                  </div>

                  <div className="matrix-topbar-tool-dropdown-body">
                    <ActiveAgents />
                  </div>
                </div>
              ) : null}
            </div>
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