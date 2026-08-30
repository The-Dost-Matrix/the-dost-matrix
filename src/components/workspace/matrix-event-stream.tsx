"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/domains/auth/auth-provider";
import { subscribeToChatMessages } from "@/domains/chat/chat-service";
import { subscribeToKnowledge } from "@/domains/knowledge/knowledge-service";
import { subscribeToMissions } from "@/domains/missions/mission-service";

import type { ChatMessage } from "@/core/domain/chat/chat-message";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";
import type { Mission } from "@/shared/types/mission";

type MatrixEvent = {
  id: string;
  title: string;
  detail: string;
  createdAt: Date | null;
  type: "mission" | "knowledge" | "chat";
};

type MatrixEventStreamProps = {
  /**
   * "panel" rendert de component als zelfstandig paneel (historisch gedrag,
   * zoals eerder gebruikt in de rechter sidebar).
   *
   * "dropdown" rendert een compactere variant zonder eigen paneel-achtergrond
   * en sectietitel, bedoeld om als inhoud van een uitklapbaar topbar-paneel
   * te dienen (de "Recent Activity"-knop in de topbar).
   */
  variant?: "panel" | "dropdown";
};

function formatEventTime(value: Date | null): string {
  if (!value) return "zojuist";

  return value.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function MatrixEventStream({
  variant = "panel",
}: MatrixEventStreamProps = {}) {
  const { user } = useAuth();

  const [missions, setMissions] = useState<Mission[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;

    const unsubscribeMissions = subscribeToMissions(
      user.uid,
      setMissions,
      (caught) => setError(caught.message),
    );

    const unsubscribeKnowledge = subscribeToKnowledge(
      user.uid,
      setKnowledge,
      (caught) => setError(caught.message),
      100,
    );

    const unsubscribeMessages = subscribeToChatMessages(
      user.uid,
      setMessages,
      (caught) => setError(caught.message),
    );

    return () => {
      unsubscribeMissions();
      unsubscribeKnowledge();
      unsubscribeMessages();
    };
  }, [user]);

  const events = useMemo<MatrixEvent[]>(() => {
    const missionEvents = missions.slice(0, 5).map((mission) => ({
      id: `mission-${mission.id}`,
      title: "Mission geregistreerd",
      detail: mission.command,
      createdAt: mission.createdAt ?? null,
      type: "mission" as const,
    }));

    const knowledgeEvents = knowledge.slice(0, 5).map((entry) => ({
      id: `knowledge-${entry.id}`,
      title:
        entry.status === "approved"
          ? "Kennisitem goedgekeurd"
          : "Kennisitem toegevoegd",
      detail: entry.title || entry.content.slice(0, 120),
      createdAt: entry.createdAt ?? null,
      type: "knowledge" as const,
    }));

    const chatEvents = messages.slice(-5).map((message) => ({
      id: `chat-${message.id}`,
      title:
        message.role === "assistant"
          ? "Director heeft geantwoord"
          : "Opdracht aan Director",
      detail: message.content.slice(0, 120),
      createdAt: message.createdAt ?? null,
      type: "chat" as const,
    }));

    return [...missionEvents, ...knowledgeEvents, ...chatEvents]
      .sort(
        (left, right) =>
          (right.createdAt?.getTime() ?? 0) -
          (left.createdAt?.getTime() ?? 0),
      )
      .slice(0, 12);
  }, [missions, knowledge, messages]);

  const isDropdown = variant === "dropdown";

  return (
    <section
      className={
        isDropdown
          ? "command-center-activity command-center-activity--dropdown"
          : "panel command-center-activity"
      }
    >
      {!isDropdown && (
        <div className="section-title">
          <div>
            <p className="eyebrow">LIVE MATRIX</p>
            <h3>Event Stream</h3>
          </div>

          <span className="badge">LIVE</span>
        </div>
      )}

      <div className="command-center-activity-list">
        {events.length === 0 ? (
          <div className="empty">
            Nog geen systeemactiviteit geregistreerd.
          </div>
        ) : (
          events.map((event) => (
            <article key={event.id}>
              <span
                className={`command-center-event-icon command-center-event-icon--${event.type}`}
              >
                {event.type === "mission"
                  ? "◎"
                  : event.type === "knowledge"
                    ? "◇"
                    : "▱"}
              </span>

              <div>
                <strong>{event.title}</strong>
                <p>{event.detail}</p>
              </div>

              <small>{formatEventTime(event.createdAt)}</small>
            </article>
          ))
        )}
      </div>

      {error && <p className="error">{error}</p>}
    </section>
  );
}
