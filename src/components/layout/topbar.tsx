"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/domains/auth/auth-provider";
import {
  subscribeToMissions,
} from "@/domains/missions/mission-service";
import {
  subscribeToChatMessages,
} from "@/domains/chat/chat-service";
import {
  subscribeToKnowledge,
} from "@/domains/knowledge/knowledge-service";

import type { Mission } from "@/shared/types/mission";
import type { ChatMessage } from "@/core/domain/chat/chat-message";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

type TickerItem = {
  id: string;
  label: string;
};

export function Topbar() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [missions, setMissions] = useState<Mission[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);

  useEffect(() => {
    if (!user) return;

    const unsubscribeMissions = subscribeToMissions(
      user.uid,
      setMissions,
      () => {},
    );

    const unsubscribeMessages = subscribeToChatMessages(
      user.uid,
      setMessages,
      () => {},
    );

    const unsubscribeKnowledge = subscribeToKnowledge(
      user.uid,
      setKnowledge,
      () => {},
      50,
    );

    return () => {
      unsubscribeMissions();
      unsubscribeMessages();
      unsubscribeKnowledge();
    };
  }, [user]);

  const missionTicker = useMemo<TickerItem[]>(() => {
    if (missions.length === 0) {
      return [
        {
          id: "missions-empty",
          label: "Matrix Core wacht op een nieuwe missie",
        },
      ];
    }

    return missions.slice(0, 8).map((mission) => ({
      id: mission.id,
      label: `${mission.status.toUpperCase()} · ${mission.command}`,
    }));
  }, [missions]);

  const eventTicker = useMemo<TickerItem[]>(() => {
    const missionEvents = missions.slice(0, 4).map((mission) => ({
      id: `mission-${mission.id}`,
      label: `Mission geregistreerd · ${mission.command}`,
    }));

    const knowledgeEvents = knowledge.slice(0, 4).map((entry) => ({
      id: `knowledge-${entry.id}`,
      label:
        entry.status === "approved"
          ? `Kennis goedgekeurd · ${entry.title || "Kennisitem"}`
          : `Kennis toegevoegd · ${entry.title || "Kennisitem"}`,
    }));

    const chatEvents = messages.slice(-4).map((message) => ({
      id: `chat-${message.id}`,
      label:
        message.role === "assistant"
          ? `Director antwoordde · ${message.content.slice(0, 90)}`
          : `Opdracht aan Director · ${message.content.slice(0, 90)}`,
    }));

    const events = [
      ...missionEvents,
      ...knowledgeEvents,
      ...chatEvents,
    ].slice(0, 10);

    if (events.length === 0) {
      return [
        {
          id: "events-empty",
          label: "Nog geen live Matrix-activiteit",
        },
      ];
    }

    return events;
  }, [missions, knowledge, messages]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <header className="matrix-topbar matrix-topbar--with-tickers">
      <div className="matrix-topbar-main">
        <div className="matrix-command-search">
          <span>⌕</span>

          <input
            aria-label="Zoeken in The Dost Matrix"
            placeholder="Search anything in your Matrix..."
            type="search"
          />

          <kbd>Ctrl K</kbd>
        </div>

        <div className="matrix-topbar-actions">
          <div className="matrix-system-status">
            <span className="matrix-status-dot" />

            <div>
              <small>SYSTEM STATUS</small>
              <strong>OPERATIONAL</strong>
            </div>
          </div>

          <button
            aria-label="Terminal"
            className="matrix-icon-button"
            disabled
            type="button"
          >
            &gt;_
          </button>

          <button
            aria-label="Meldingen"
            className="matrix-icon-button"
            disabled
            type="button"
          >
            ♧
          </button>

          <button
            aria-label="Instellingen"
            className="matrix-icon-button"
            disabled
            type="button"
          >
            ⚙
          </button>

          <div className="matrix-profile">
            <div className="matrix-profile-avatar">
              {(user?.email?.[0] ?? "E").toUpperCase()}
            </div>

            <div className="matrix-profile-details">
              <strong>Elroy</strong>
              <span>Owner</span>
            </div>

            <button
              className="matrix-profile-signout"
              onClick={() => void handleSignOut()}
              type="button"
            >
              Uitloggen
            </button>
          </div>
        </div>
      </div>

      <div className="matrix-ticker matrix-ticker--missions">
        <span className="matrix-ticker-label">ACTIVE MISSIONS</span>

        <div className="matrix-ticker-viewport">
          <div className="matrix-ticker-track">
            {[...missionTicker, ...missionTicker].map((item, index) => (
              <span
                className="matrix-ticker-item"
                key={`${item.id}-${index}`}
              >
                <b>◆</b>
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="matrix-ticker matrix-ticker--events">
        <span className="matrix-ticker-label">LIVE MATRIX</span>

        <div className="matrix-ticker-viewport">
          <div className="matrix-ticker-track matrix-ticker-track--reverse">
            {[...eventTicker, ...eventTicker].map((item, index) => (
              <span
                className="matrix-ticker-item"
                key={`${item.id}-${index}`}
              >
                <b>◇</b>
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}