"use client";

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/domains/auth/auth-provider";
import {
  sendChatMessage,
  subscribeToChatMessages,
} from "@/domains/chat/chat-service";

import type { ChatMessage } from "@/core/domain/chat/chat-message";

export function DirectorChat() {
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const listEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;

    return subscribeToChatMessages(
      user.uid,
      setMessages,
      (subscriptionError) => {
        setError(subscriptionError.message);
      },
    );
  }, [user]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages]);

  async function sendCurrentDraft() {
    if (!user || !draft.trim() || busy) return;

    const content = draft.trim();

    setDraft("");
    setBusy(true);
    setError("");

    try {
      await sendChatMessage(user, content);
    } catch (caught) {
      setDraft(content);
      setError(
        caught instanceof Error
          ? caught.message
          : "Bericht versturen is mislukt.",
      );
    } finally {
      setBusy(false);
    }
  }

  function submitMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    void sendCurrentDraft();
  }

  return (
    <section className="panel chat-panel command-center-chat">
      <div className="section-title">
        <div>
          <p className="eyebrow">DIRECTOR</p>
          <h3>Chat & Assistant</h3>
        </div>

        <span className="badge">
          {messages.length} BERICHTEN
        </span>
      </div>

      <form
        className="chat-input-row chat-input-row--top"
        onSubmit={submitMessage}
      >
        <textarea
          rows={5}
          placeholder="Vraag Director iets of geef een opdracht..."
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
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
          disabled={busy || !draft.trim()}
        >
          {busy ? "Bezig..." : "Verstuur"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <div className="chat-log chat-log--below-input">
        {messages.length === 0 ? (
          <div className="empty">
            Director staat klaar. Geef een opdracht of stel een vraag.
          </div>
        ) : (
          messages.map((message) => (
            <article
              className={`chat-bubble chat-bubble--${message.role}`}
              key={message.id}
            >
              <p>{message.content}</p>

              <small>
                {message.role === "assistant" && message.model
                  ? `${message.model} · `
                  : ""}

                {message.createdAt
                  ? message.createdAt.toLocaleTimeString("nl-NL")
                  : "verzenden..."}
              </small>
            </article>
          ))
        )}

        <div ref={listEnd} />
      </div>
    </section>
  );
}