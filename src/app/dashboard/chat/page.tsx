"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/domains/auth/auth-provider";
import {
  createMission,
  subscribeToMissions,
} from "@/domains/missions/mission-service";
import {
  sendChatMessage,
  subscribeToChatMessages,
} from "@/domains/chat/chat-service";
import { subscribeToKnowledge } from "@/domains/knowledge/knowledge-service";
import { SecondBrainPanel } from "@/components/workspace/second-brain-panel";

import type { Mission } from "@/shared/types/mission";
import type { ChatMessage } from "@/core/domain/chat/chat-message";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

function formatTime(date: Date | null | undefined): string {
  if (!date) {
    return "zojuist";
  }

  return date.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [missions, setMissions] = useState<Mission[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);

  const [draft, setDraft] = useState("");
  const [missionCommand, setMissionCommand] = useState("");

  const [chatBusy, setChatBusy] = useState(false);
  const [missionBusy, setMissionBusy] = useState(false);
  const [error, setError] = useState("");

  const listEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const unsubscribeMissions = subscribeToMissions(
      user.uid,
      setMissions,
      (subscriptionError) => {
        setError(subscriptionError.message);
      },
    );

    const unsubscribeMessages = subscribeToChatMessages(
      user.uid,
      setMessages,
      (subscriptionError) => {
        setError(subscriptionError.message);
      },
    );

    const unsubscribeKnowledge = subscribeToKnowledge(
      user.uid,
      setKnowledge,
      (subscriptionError) => {
        setError(subscriptionError.message);
      },
      250,
    );

    return () => {
      unsubscribeMissions();
      unsubscribeMessages();
      unsubscribeKnowledge();
    };
  }, [user]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages]);

  const pendingKnowledge = useMemo(
    () =>
      knowledge.filter(
        (entry) => entry.status === "pending",
      ),
    [knowledge],
  );

  const approvedKnowledge = useMemo(
    () =>
      knowledge.filter(
        (entry) =>
          !entry.status || entry.status === "approved",
      ),
    [knowledge],
  );

  const activeMissions = useMemo(
    () =>
      missions
        .filter((mission) => mission.status !== "completed")
        .slice(0, 4),
    [missions],
  );

  const recentActivity = useMemo(() => {
    const activities: Array<{
      id: string;
      title: string;
      detail: string;
      time: Date | null;
      type: "mission" | "knowledge" | "chat";
    }> = [];

    for (const mission of missions.slice(0, 4)) {
      activities.push({
        id: `mission-${mission.id}`,
        title: "Mission bijgewerkt",
        detail: mission.command,
        time: mission.createdAt ?? null,
        type: "mission",
      });
    }

    for (const entry of knowledge.slice(0, 4)) {
      activities.push({
        id: `knowledge-${entry.id}`,
        title:
          entry.status === "approved"
            ? "Kennisitem goedgekeurd"
            : "Kennisitem toegevoegd",
        detail:
          entry.title ||
          entry.content.slice(0, 90),
        time: entry.createdAt ?? null,
        type: "knowledge",
      });
    }

    for (const message of messages.slice(-3)) {
      activities.push({
        id: `chat-${message.id}`,
        title:
          message.role === "assistant"
            ? "Director heeft geantwoord"
            : "Nieuwe opdracht verzonden",
        detail: message.content.slice(0, 90),
        time: message.createdAt ?? null,
        type: "chat",
      });
    }

    return activities
      .sort(
        (left, right) =>
          (right.time?.getTime() ?? 0) -
          (left.time?.getTime() ?? 0),
      )
      .slice(0, 8);
  }, [missions, knowledge, messages]);

  async function sendCurrentDraft() {
    if (!user || !draft.trim() || chatBusy) {
      return;
    }

    const content = draft.trim();

    setDraft("");
    setChatBusy(true);
    setError("");

    try {
      await sendChatMessage(user, content);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Bericht versturen is mislukt.",
      );
      setDraft(content);
    } finally {
      setChatBusy(false);
    }
  }

  function submitMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void sendCurrentDraft();
  }

  async function submitMission(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !user ||
      !missionCommand.trim() ||
      missionBusy
    ) {
      return;
    }

    setMissionBusy(true);
    setError("");

    try {
      await createMission(
        user.uid,
        missionCommand.trim(),
      );
      setMissionCommand("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Missie opslaan is mislukt.",
      );
    } finally {
      setMissionBusy(false);
    }
  }

  if (loading || !user) {
    return (
      <main className="center-screen">
        Matrix Core wordt geladen...
      </main>
    );
  }

  return (
    <main className="dashboard-shell command-center-dashboard">
      <section className="panel command-center-intro">
        <div>
          <p className="eyebrow">
            MATRIX COMMAND CENTER
          </p>

          <h1>Goed dat je er bent, Elroy.</h1>

          <p className="muted">
            Director, Second Brain, missies en
            realtime systeemactiviteit zijn verbonden
            in één werkruimte.
          </p>
        </div>

        <div className="command-center-stats">
          <article>
            <span>ACTIVE MISSIONS</span>
            <strong>{activeMissions.length}</strong>
          </article>

          <article>
            <span>KNOWLEDGE</span>
            <strong>{knowledge.length}</strong>
          </article>

          <article>
            <span>PENDING REVIEW</span>
            <strong>{pendingKnowledge.length}</strong>
          </article>

          <article>
            <span>DIRECTOR</span>
            <strong className="status-online">
              READY
            </strong>
          </article>
        </div>
      </section>

      <section className="command-center-main-grid">
        <div className="panel command-center-missions">
          <div className="section-title">
            <div>
              <p className="eyebrow">
                ACTIVE MISSIONS
              </p>
              <h3>Mission Control</h3>
            </div>

            <button
              className="secondary"
              onClick={() =>
                router.push("/dashboard")
              }
              type="button"
            >
              {missions.length} totaal
            </button>
          </div>

          <div className="mission-list command-center-mission-list">
            {activeMissions.length === 0 ? (
              <div className="empty">
                Er zijn nog geen actieve missies.
              </div>
            ) : (
              activeMissions.map((mission) => (
                <article
                  className="mission-card"
                  key={mission.id}
                >
                  <div>
                    <span className="mission-status">
                      {mission.status}
                    </span>

                    <p>{mission.command}</p>
                  </div>

                  <small>
                    {mission.createdAt
                      ? mission.createdAt.toLocaleString(
                          "nl-NL",
                        )
                      : "Wordt opgeslagen..."}
                  </small>
                </article>
              ))
            )}
          </div>

          <form
            className="command-center-quick-command"
            onSubmit={submitMission}
          >
            <input
              placeholder="Maak een nieuwe missie..."
              value={missionCommand}
              onChange={(event) =>
                setMissionCommand(event.target.value)
              }
            />

            <button
              className="primary"
              disabled={
                missionBusy ||
                !missionCommand.trim()
              }
            >
              {missionBusy
                ? "Vastleggen..."
                : "Nieuwe missie"}
            </button>
          </form>
        </div>

        <div className="command-center-columns">
          <div className="panel chat-panel command-center-chat">
            <div className="section-title">
              <div>
                <p className="eyebrow">
                  DIRECTOR
                </p>
                <h3>Chat & Assistant</h3>
              </div>

              <span className="badge">
                {messages.length} BERICHTEN
              </span>
            </div>

            <div className="chat-log">
              {messages.length === 0 ? (
                <div className="empty">
                  Director staat klaar. Geef een
                  opdracht of stel een vraag.
                </div>
              ) : (
                messages.map((message) => (
                  <article
                    className={`chat-bubble chat-bubble--${message.role}`}
                    key={message.id}
                  >
                    <p>{message.content}</p>

                    <small>
                      {message.role === "assistant" &&
                      message.model
                        ? `${message.model} · `
                        : ""}

                      {message.createdAt
                        ? message.createdAt.toLocaleTimeString(
                            "nl-NL",
                          )
                        : "verzenden..."}
                    </small>
                  </article>
                ))
              )}

              <div ref={listEnd} />
            </div>

            <form
              className="chat-input-row"
              onSubmit={submitMessage}
            >
              <textarea
                rows={2}
                placeholder="Vraag Director iets of geef een opdracht..."
                value={draft}
                onChange={(event) =>
                  setDraft(event.target.value)
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey
                  ) {
                    event.preventDefault();
                    void sendCurrentDraft();
                  }
                }}
              />

              <button
                className="primary"
                disabled={chatBusy || !draft.trim()}
              >
                {chatBusy ? "Bezig..." : "Verstuur"}
              </button>
            </form>
          </div>

          <div className="panel command-center-brain">
            <div className="section-title">
              <div>
                <p className="eyebrow">
                  SECOND BRAIN
                </p>
                <h3>Connected Knowledge</h3>
              </div>

              <button
                className="secondary"
                onClick={() =>
                  router.push("/dashboard/knowledge")
                }
                type="button"
              >
                Open
              </button>
            </div>

            <div className="command-center-brain-visual">
              <SecondBrainPanel />
            </div>
          </div>
        </div>
      </section>

      <section className="panel command-center-activity">
        <div className="section-title">
          <div>
            <p className="eyebrow">
              REALTIME ACTIVITY
            </p>
            <h3>Matrix Event Stream</h3>
          </div>

          <span className="badge">
            LIVE
          </span>
        </div>

        <div className="command-center-activity-list">
          {recentActivity.length === 0 ? (
            <div className="empty">
              Nog geen systeemactiviteit geregistreerd.
            </div>
          ) : (
            recentActivity.map((activity) => (
              <article key={activity.id}>
                <span
                  className={`command-center-event-icon command-center-event-icon--${activity.type}`}
                >
                  {activity.type === "mission"
                    ? "◎"
                    : activity.type === "knowledge"
                      ? "◇"
                      : "▱"}
                </span>

                <div>
                  <strong>{activity.title}</strong>
                  <p>{activity.detail}</p>
                </div>

                <small>
                  {formatTime(activity.time)}
                </small>
              </article>
            ))
          )}
        </div>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}