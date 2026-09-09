"use client";

import { deriveMissionPhases, type MissionPhaseState } from "@/core/mission-engine/v2/mission-progress";
import type { MissionV2 } from "@/core/mission-engine/v2/mission";

/**
 * Missievoortgang volgens hoofdstuk 8 van het functioneel ontwerp, maar
 * uitsluitend met fases waarvoor de missie ook echt gegevens bevat — zie
 * mission-progress.ts voor waarom "Verificatie" en "Review" hier nog
 * ontbreken.
 *
 * Onder de fases staan de succescriteria met hun echte status en, waar
 * aanwezig, de toelichting van de laatste QA-beoordeling. Die toelichting
 * werd tot nu toe alleen aan de Director doorgegeven en was nergens voor de
 * eigenaar zichtbaar, terwijl juist daar staat waaróm iets is afgekeurd.
 *
 * Onderaan staan de toewijzingen zelf (rol, status, opdrachttekst,
 * succescriteria). Restpunt (7 september 2026): die opdrachttekst werd al
 * die tijd wel opgeslagen op MissionAssignmentRecord.objective, maar was in
 * de app nergens te zien — bij regressietest D kon daardoor niet worden
 * vastgesteld óf een CI-logboek daadwerkelijk in een herstelopdracht zat, of
 * dat de Builder de fout zelf uit het bestand afleidde. Nieuwste toewijzing
 * eerst, zodat de actuele opdracht altijd zonder scrollen zichtbaar is.
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

export interface MissionProgressPanelProps {
  mission?: MissionV2 | null;
}

export function MissionProgressPanel({ mission }: MissionProgressPanelProps) {
  if (!mission) {
    return (
      <section className="matrix-hud-panel mev2-progress">
        <div className="matrix-hud-panel-header">
          <h3>Missievoortgang</h3>
          <span>GEEN MISSIE</span>
        </div>

        <p className="matrix-status-empty">
          Kies links een missie, of maak er een aan om de voortgang te volgen.
        </p>
      </section>
    );
  }

  const phases = deriveMissionPhases(mission);

  return (
    <section className="matrix-hud-panel mev2-progress">
      <div className="matrix-hud-panel-header">
        <h3>Missievoortgang</h3>
        <span>{mission.riskLevel}</span>
      </div>

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
              <li className={`mev2-criterion mev2-criterion--${criterion.status.toLowerCase()}`} key={criterion.criterionId}>
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

      {mission.assignments.length > 0 && (
        <div className="mev2-assignments">
          <p className="mev2-criteria-title">Toewijzingen</p>

          <ul>
            {[...mission.assignments]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((assignment) => (
                <li
                  className={`mev2-assignment mev2-assignment--${assignment.status.toLowerCase()}`}
                  key={assignment.assignmentId}
                >
                  <div className="mev2-assignment-head">
                    <span className="mev2-assignment-role">{assignment.roleId}</span>
                    <span className="mev2-assignment-status">{assignment.status}</span>
                    {assignment.kind && assignment.kind !== "BUILD" && (
                      <span className="mev2-assignment-kind">{assignment.kind}</span>
                    )}
                  </div>

                  <p className="mev2-assignment-objective">{assignment.objective}</p>

                  {assignment.successCriteria.length > 0 && (
                    <ul className="mev2-assignment-criteria">
                      {assignment.successCriteria.map((criterion) => (
                        <li key={criterion}>{criterion}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
