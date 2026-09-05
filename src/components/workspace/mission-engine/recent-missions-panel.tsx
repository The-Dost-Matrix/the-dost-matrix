"use client";

import { useMissionEngine } from "@/domains/missions/mission-engine-store";
import { missionStatusLabel } from "@/domains/missions/mission-labels";

import "@/components/workspace/mission-engine/mission-panels.css";

/** Paneel "Recente missies" — kiezen welke missie de andere panelen tonen. */
export function RecentMissionsPanel() {
  const { missions, mission, selectMission } = useMissionEngine();

  if (missions.length === 0) return null;

  return (
    <section className="panel mev2-recent-missions dm-panel">
      <div className="section-title mev2-recent-missions__header">
        <div>
          <p className="eyebrow mev2-recent-missions__eyebrow">RECENTE MISSIES</p>
          <h3 className="mev2-recent-missions__title">Kies een missie</h3>
        </div>
      </div>

      <div className="mission-list mev2-recent-missions__list dm-scroll">
        {missions.map((candidate) => (
          <button
            key={candidate.missionId}
            type="button"
            className={
              mission?.missionId === candidate.missionId
                ? "mission-card mission-card--active mev2-recent-missions__item"
                : "mission-card mev2-recent-missions__item"
            }
            onClick={() => selectMission(candidate)}
          >
            <span className="mission-status">{missionStatusLabel(candidate.status)}</span>
            <p>{candidate.title}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
