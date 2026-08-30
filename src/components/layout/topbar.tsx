"use client";

import { useRouter } from "next/navigation";

import { useAuth } from "@/domains/auth/auth-provider";

/**
 * Topbar zonder de "ACTIVE MISSIONS" / "LIVE MATRIX" tickers: die scrollende
 * balken renderden niet meer correct (geen bruikbare scroll-animatie meer,
 * platte tekst die overliep) en zijn op verzoek van de eigenaar volledig
 * verwijderd, samen met de data-subscriptions (missies, chatberichten,
 * kennis) die uitsluitend voor die tickers bestonden — die informatie staat
 * al elders in het Command Center (bv. het "Recent Activity"-paneel).
 */
export function Topbar() {
  const router = useRouter();
  const { user, signOut } = useAuth();

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
