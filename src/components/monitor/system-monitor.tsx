"use client";

export function SystemMonitor() {
  return (
    <aside className="matrix-right-rail">
      <section className="matrix-hud-panel">
        <div className="matrix-hud-panel-header">
          <h3>Recent Activity</h3>
          <span>LIVE</span>
        </div>

        <div className="matrix-activity-list">
          <article>
            <span className="matrix-activity-dot matrix-activity-dot--blue" />
            <div>
              <strong>Document pipeline active</strong>
              <small>Markdown import operational</small>
            </div>
          </article>

          <article>
            <span className="matrix-activity-dot matrix-activity-dot--green" />
            <div>
              <strong>Knowledge Foundation online</strong>
              <small>Review queue connected</small>
            </div>
          </article>

          <article>
            <span className="matrix-activity-dot matrix-activity-dot--purple" />
            <div>
              <strong>Second Brain connected</strong>
              <small>Approved knowledge available</small>
            </div>
          </article>
        </div>
      </section>

      <section className="matrix-hud-panel">
        <div className="matrix-hud-panel-header">
          <h3>System Monitor</h3>
          <span>STABLE</span>
        </div>

        <div className="matrix-monitor-list">
          <div>
            <span>Firebase</span>
            <strong>ONLINE</strong>
          </div>

          <div>
            <span>OpenAI</span>
            <strong>READY</strong>
          </div>

          <div>
            <span>Knowledge</span>
            <strong>CONNECTED</strong>
          </div>

          <div>
            <span>Documents</span>
            <strong>ACTIVE</strong>
          </div>
        </div>
      </section>

      <section className="matrix-hud-panel">
        <div className="matrix-hud-panel-header">
          <h3>Active Agents</h3>
          <span>FOUNDATION</span>
        </div>

        <div className="matrix-agent-list">
          <article>
            <span className="matrix-agent-symbol">◈</span>
            <div>
              <strong>Director</strong>
              <small>Central interface</small>
            </div>
            <span className="matrix-agent-state">ACTIVE</span>
          </article>

          <article>
            <span className="matrix-agent-symbol">◇</span>
            <div>
              <strong>Knowledge Agent</strong>
              <small>Review pipeline</small>
            </div>
            <span className="matrix-agent-state">ACTIVE</span>
          </article>

          <article>
            <span className="matrix-agent-symbol">▧</span>
            <div>
              <strong>Document Agent</strong>
              <small>Import foundation</small>
            </div>
            <span className="matrix-agent-state">ACTIVE</span>
          </article>

          <article>
            <span className="matrix-agent-symbol">⌘</span>
            <div>
              <strong>Builder Agent</strong>
              <small>Not connected yet</small>
            </div>
            <span className="matrix-agent-state matrix-agent-state--idle">
              IDLE
            </span>
          </article>
        </div>
      </section>
    </aside>
  );
}