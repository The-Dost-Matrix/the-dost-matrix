"use client";

import type { FormEvent } from "react";

import type { MissionRiskLevel } from "@/core/mission-engine/v2/mission";
import { useMissionEngine } from "@/domains/missions/mission-engine-store";
import { RISK_LEVELS, riskLevelLabel } from "@/domains/missions/mission-labels";

import "@/components/workspace/mission-engine/mission-panels.css";

/**
 * Paneel "Nieuwe missie". Heeft bewust geen props: alles komt uit de
 * gedeelde MissionEngineProvider, zodat dit paneel op elke pagina en op elke
 * plek in een indeling kan staan zonder dat de omgeving iets hoeft door te
 * geven.
 */
export function MissionCreatePanel() {
  const { form, busy, createMission } = useMissionEngine();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void createMission();
  }

  return (
    <section className="panel dm-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">MISSION ENGINE</p>
          <h3>Nieuwe missie</h3>
        </div>
      </div>

      <form className="dm-panel-body mission-create-form" onSubmit={onSubmit}>
        <div className="mission-engine-v2-form-group">
          <input
            className="mission-engine-v2-form-field"
            placeholder="Titel"
            value={form.title}
            onChange={(event) => form.setTitle(event.target.value)}
          />
        </div>

        <div className="mission-engine-v2-form-group">
          <input
            className="mission-engine-v2-form-field"
            placeholder="Doel (wat moet er bereikt worden?)"
            value={form.objective}
            onChange={(event) => form.setObjective(event.target.value)}
          />
        </div>

        <div className="mission-engine-v2-form-group dm-grow">
          <textarea
            className="mission-engine-v2-form-textarea dm-textarea-grow"
            rows={8}
            placeholder="Succescriteria, één per regel"
            value={form.successCriteriaText}
            onChange={(event) => form.setSuccessCriteriaText(event.target.value)}
          />
        </div>

        <div className="mission-engine-v2-form-group">
          <label className="mev2-risk-label" htmlFor="dm-risk-level">
            Risiconiveau van deze missie
          </label>

          <select
            id="dm-risk-level"
            className="mission-engine-v2-form-field"
            value={form.riskLevel}
            onChange={(event) => form.setRiskLevel(event.target.value as MissionRiskLevel)}
          >
            {RISK_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level} — {riskLevelLabel(level)}
              </option>
            ))}
          </select>
        </div>

        <button
          className="primary mission-engine-v2-form-submit mission-engine-v2-form-submit-block"
          disabled={busy === "create"}
        >
          {busy === "create" ? "Bezig..." : "Missie aanmaken en starten"}
        </button>
      </form>
    </section>
  );
}
