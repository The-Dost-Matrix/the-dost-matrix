"use client";

import {
  statusIcon,
  statusLabel,
  statusModifier,
  useSystemStatus,
} from "@/domains/system/system-status-service";
import { useAuth } from "@/domains/auth/auth-provider";

/**
 * Toonde tot nu toe vier hardgecodeerde regels ("Firebase ONLINE", "OpenAI
 * READY", ...) die niets controleerden. Nu komt alles uit /api/system/status,
 * inclusief de vermelding hoe elke status is vastgesteld: uit configuratie of
 * met een echte aanroep. Ontbrekende configuratie wordt als zodanig getoond in
 * plaats van als "actief".
 *
 * De regel "Jouw gebruikers-ID" (stap 15, deel 2) staat hier — niet omdat het
 * inhoudelijk bij "systeemstatus" hoort, maar omdat dit het scherm is waarvan
 * we zeker weten dat Elroy het al kan vinden en vertrouwt. De Firebase
 * Console (Authentication → Users) bleek in de praktijk verwarrend: meerdere
 * Google-accounts in dezelfde browser lieten hem op de verkeerde account
 * belanden, met een lege "geen project"-pagina tot gevolg — dit voorkomt dat
 * hij daar nog eens doorheen moet. `user.uid` staat client-side al
 * beschikbaar via useAuth() (nodig voor elke ingelogde API-aanroep), dus dit
 * kost geen extra netwerkaanroep of backend-wijziging.
 */
export function SystemMonitorPanel() {
  const { report, loading, error } = useSystemStatus();
  const { user } = useAuth();

  return (
    <section className="matrix-hud-panel matrix-dropdown-panel">
      <div className="matrix-hud-panel-header">
        <h3>Systeemstatus</h3>
        <span>{loading ? "CONTROLEREN" : error ? "ONBEKEND" : "GECONTROLEERD"}</span>
      </div>

      {error && <p className="matrix-status-error">{error}</p>}

      {loading && !report && <p className="matrix-status-empty">Status wordt opgehaald…</p>}

      {report && (
        <>
          <div className="matrix-status-list">
            {report.components.map((component) => (
              <article key={component.id} className="matrix-status-row">
                <div className="matrix-status-row-head">
                  <span className={`matrix-status-badge ${statusModifier(component.level)}`}>
                    <span aria-hidden="true">{statusIcon(component.level)}</span>
                    {statusLabel(component.level)}
                  </span>

                  <strong>{component.label}</strong>
                </div>

                <p className="matrix-status-detail">{component.detail}</p>

                <small className="matrix-status-source">
                  vastgesteld via {component.checkedVia}
                </small>
              </article>
            ))}
          </div>

          <p className="matrix-status-timestamp">
            Gecontroleerd om{" "}
            {new Date(report.checkedAt).toLocaleTimeString("nl-NL", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </>
      )}

      {user && (
        <article className="matrix-status-row">
          <div className="matrix-status-row-head">
            <strong>Jouw gebruikers-ID</strong>
          </div>
          <p className="matrix-status-detail matrix-status-uid">{user.uid}</p>
          <small className="matrix-status-source">
            nodig als MISSION_ADVANCE_OWNER_ID in Vercel — selecteer en kopieer de regel hierboven
          </small>
        </article>
      )}
    </section>
  );
}
