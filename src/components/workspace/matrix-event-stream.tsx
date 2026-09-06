"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/domains/auth/auth-provider";
import { subscribeToChatMessages } from "@/domains/chat/chat-service";
import { subscribeToKnowledge } from "@/domains/knowledge/knowledge-service";

import type { ChatMessage } from "@/core/domain/chat/chat-message";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

/**
 * Toont recente gebeurtenissen uit de Second Brain en de chat met de
 * Director.
 *
 * Er stonden hier ook missiegebeurtenissen bij ("Mission geregistreerd"),
 * gevoed door de Firestore-collectie `missions`. Dat is het missiemodel van
 * vóór Mission Engine V2, dat naar `missionEngineV2Missions` schrijft — de
 * regels hier hoorden dus niet bij de missies die je in de Mission Engine
 * ziet. Sinds het oude paneel en de dubbele chatpagina zijn verwijderd,
 * schrijft niets meer naar die collectie: er kwam nooit meer een nieuwe
 * regel bij, en de bestaande waren voorgoed dezelfde.
 *
 * Missies horen hier op termijn wél thuis, maar dan gevoed door Mission
 * Engine V2. Dat vraagt een leesweg voor de browser die er nu niet is (de
 * V2-missies worden uitsluitend aan de serverkant gelezen). Tot die er is
 * staan er liever geen missieregels dan de verkeerde.
 */
type MatrixEvent = {
  id: string;
  title: string;
  detail: string;
  createdAt: Date | null;
  type: "knowledge" | "chat";
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

  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;

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
      unsubscribeKnowledge();
      unsubscribeMessages();
    };
  }, [user]);

  const events = useMemo<MatrixEvent[]>(() => {
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

    return [...knowledgeEvents, ...chatEvents]
      .sort(
        (left, right) =>
          (right.createdAt?.getTime() ?? 0) -
          (left.createdAt?.getTime() ?? 0),
      )
      .slice(0, 12);
  }, [knowledge, messages]);

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
                {event.type === "knowledge" ? "◇" : "▱"}
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
