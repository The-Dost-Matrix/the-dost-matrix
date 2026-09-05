"use client";

import { deriveMissionPhases, type MissionPhaseState } from "@/core/mission-engine/v2/mission-progress";
import { useMissionEngine } from "@/domains/missions/mission-engine-store";

import "@/components/workspace/mission-engine/mission-panels.css";

/**
 * Missievoortgang volgens hoofdstuk 8 van het functioneel ontwerp, maar
 * uitsluitend met fases waarvoor de missie ook echt gegevens bevat — zie
 * mission-progress.ts voor waarom "Verificatie" en "Review" hier nog
 * ontbreken.
 *
 * Onder de fases staan de succescriteria met hun echte status en, waar
 * aanwezig, de toelichting van de laatste QA-beoordeling. Die toelichting
 * ging tot nu toe alleen naar de Director en was nergens voor de eigenaar
 * zichtbaar, terwijl juist daar staat waaróm iets is afgekeurd.
 *
 * Geen props: net als de andere panelen haalt dit zijn missie uit de
 * gedeelde MissionEngineProvider, zodat het paneel overal neergezet kan
 * worden zonder dat de pagina iets hoeft door te geven.
 */

const STATE_ICON: Record<MissionPhaseState, string> = {
  WACHT: "○",
  BEZIG: "◐",
  KLAAR: "●",
  AANDACHT: "!",
};

function stateModifier(state: MissionPhaseState): string {
  return `mev2-phase--${state.toLowerCase()}`;
}

export function MissionProgressPanel() {
  const { mission } = useMissionEngine();

  if (!mission) {
    return (
      <section className="panel dm-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">MISSIEVOORTGANG</p>
            <h3>Fases</h3>
          </div>

          <span className="badge">GEEN MISSIE</span>
        </div>

        <div className="empty">Maak een missie aan of kies er een om de voortgang te volgen.</div>
      </section>
    );
  }

  const phases = deriveMissionPhases(mission);

  return (
    <section className="panel dm-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">MISSIEVOORTGANG</p>
          <h3>Fases</h3>
        </div>

        <span className="badge">{mission.riskLevel}</span>
      </div>

      <div className="dm-panel-body dm-scroll">
        <p className="mev2-progress-title">{mission.title}</p>

        <ol className="mev2-phase-list">
          {phases.map((phase) => (
            <li className={`mev2-phase ${stateModifier(phase.state)}`} key={phase.id}>
              <span aria-hidden="true" className="mev2-phase-icon">
                {STATE_ICON[phase.state]}
              </span>

              <div>
                <strong>{phase.label}</strong>
                <small>{phase.detail}</small>
              </div>

              <span className="mev2-phase-state">{phase.state}</span>
            </li>
          ))}
        </ol>

        {mission.successCriteria.length > 0 && (
          <div className="mev2-criteria">
            <p className="mev2-criteria-title">Succescriteria</p>

            <ul>
              {mission.successCriteria.map((criterion) => (
                <li
                  className={`mev2-criterion mev2-criterion--${criterion.status.toLowerCase()}`}
                  key={criterion.criterionId}
                >
                  <span className="mev2-criterion-status">{criterion.status}</span>
                  <span className="mev2-criterion-text">{criterion.description}</span>

                  {criterion.lastEvaluationNote && (
                    <small className="mev2-criterion-note">{criterion.lastEvaluationNote}</small>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
