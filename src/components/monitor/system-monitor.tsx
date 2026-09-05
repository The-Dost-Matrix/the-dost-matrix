"use client";

import {
  statusIcon,
  statusLabel,
  statusModifier,
  useSystemStatus,
} from "@/domains/system/system-status-service";

/**
 * Toonde tot nu toe vier hardgecodeerde regels ("Firebase ONLINE", "OpenAI
 * READY", ...) die niets controleerden. Nu komt alles uit /api/system/status,
 * inclusief de vermelding hoe elke status is vastgesteld: uit configuratie of
 * met een echte aanroep. Ontbrekende configuratie wordt als zodanig getoond in
 * plaats van als "actief".
 */
export function SystemMonitorPanel() {
  const { report, loading, error } = useSystemStatus();

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
    </section>
  );
}
