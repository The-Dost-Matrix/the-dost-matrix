"use client";

import { useEffect, useState } from "react";

import { MatrixBrainWebGL } from "@/components/brain/matrix-brain-webgl";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";
import { useAuth } from "@/domains/auth/auth-provider";
import { subscribeToKnowledge } from "@/domains/knowledge/knowledge-service";

export function SecondBrainPanel() {
  const { user } = useAuth();
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);

  useEffect(() => {
    if (!user) return;

    return subscribeToKnowledge(
      user.uid,
      setKnowledge,
      () => {},
      25,
    );
  }, [user]);

  const latestEntry = knowledge[0];

  return (
    <section className="panel second-brain-compact">
      <div className="section-title">
        <div>
          <p className="eyebrow">SECOND BRAIN</p>
          <h3>Connected Knowledge</h3>
        </div>

        <span className="badge">{knowledge.length}</span>
      </div>

      <div className="second-brain-visual">
        <MatrixBrainWebGL />
      </div>

      <div className="second-brain-latest">
        <p className="eyebrow">MEEST RECENT TOEGEVOEGD</p>

        {latestEntry ? (
          <article className="knowledge-card">
            <strong>{latestEntry.title || "Kennisitem"}</strong>

            <p>
              {latestEntry.summary ||
                (latestEntry.content.length > 160
                  ? `${latestEntry.content.slice(0, 160)}…`
                  : latestEntry.content)}
            </p>

            <small>
              {(latestEntry.type ?? "fact").toUpperCase()} ·{" "}
              {(latestEntry.status ?? "approved").toUpperCase()}
            </small>
          </article>
        ) : (
          <div className="empty">
            Nog geen kennis beschikbaar.
          </div>
        )}
      </div>
    </section>
  );
}