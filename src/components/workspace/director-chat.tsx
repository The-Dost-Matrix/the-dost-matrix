"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { useAuth } from "@/domains/auth/auth-provider";
import { askCouncil, sendChatMessage, subscribeToChatMessages } from "@/domains/chat/chat-service";

import type { ChatMessage } from "@/core/domain/chat/chat-message";

import "@/components/workspace/director-chat.css";

/**
 * Chat met de Director, met dezelfde bediening als een gewone chat-app:
 * Enter verstuurt, Shift+Enter maakt een nieuwe regel, het invoerveld begint
 * als één regel en groeit mee met de tekst, en zolang de Director nadenkt
 * staan er bewegende puntjes onderaan het gesprek.
 *
 * Enter-om-te-versturen en het direct verschijnen van je eigen bericht
 * werkten al: chat-service.ts schrijft het bericht van de eigenaar naar
 * Firestore VOORDAT de LLM-aanroep begint, waardoor de Firestore-subscriptie
 * de eigen bubbel meteen laat zien in plaats van pas na het antwoord.
 *
 * Dit is sinds het opheffen van de dubbele chatpagina de enige chat in de
 * app: /dashboard/chat was een oude kopie van het hele Command Center met
 * een eigen, gekopieerd chatpaneel (en het inmiddels vervangen missiemodel).
 * Die pagina is verwijderd; hier verandert de chat, en nergens anders meer.
 *
 * Bewust NIET aanwezig: een knop om bijlagen toe te voegen. De
 * modelverbinding accepteert vandaag alleen tekst (zie LlmProvider in
 * core/llm/types.ts: chatCompletion krijgt LlmMessage[] met een `content`
 * van het type string) en er is nergens opslag voor bestanden ingericht. Een
 * paperclip zou dus wel een bestandsnaam kunnen tonen, maar de Director zou
 * er niets van zien — precies het soort schijnfunctie dat bij de UI-basis is
 * weggehaald. Komt terug zodra de modelverbinding beeld aankan.
 *
 * Stap 13 — The Dost Council V1 (dun): naast de ronde verstuurknop (naar de
 * Director, één model) staat "Vraag de Raad" — dezelfde vraag, maar naar
 * runCouncilSession (zie core/application/council/council-service.ts): twee
 * onafhankelijke modellen die blind analyseren, elkaar geanonimiseerd
 * bekritiseren, en het expliciet oneens mogen zijn. Bewust een aparte knop
 * en geen automatische keuze: een fout besluit van de raad raakt hier de
 * merge-route niet (dit is puur een chatmodus), en Elroy kiest zelf wanneer
 * een vraag zwaar genoeg is om twee meningen te rechtvaardigen — de raad kost
 * meetbaar meer dan een gewoon bericht (zie de kostenregel onderaan het
 * raadsantwoord). Het antwoord van de raad komt, net als een gewoon
 * Director-antwoord, gewoon in dezelfde geschiedenis terecht; het
 * modelveld begint met "council/" zodat de avatar hieronder "⬡" toont in
 * plaats van "D".
 */

/**
 * Startsuggesties: ze VULLEN alleen het invoerveld, ze versturen niets, en
 * ze verdwijnen zodra het gesprek loopt. Alle vier verwijzen naar iets dat
 * de Director daadwerkelijk kan (missies aanmaken vanuit de chat, de eigen
 * codebase en docs lezen). Geen suggestie stuurt automatisch naar de raad:
 * een suggestie vult alleen het veld, en welke knop je daarna gebruikt
 * (Verstuur of Vraag de Raad) blijft altijd een eigen keuze.
 */
const SUGGESTIONS = [
  "Plan een nieuwe missie",
  "Analyseer een probleem",
  "Help me met een feature",
  "Wat staat er open op de roadmap?",
];

/** Boven deze hoogte scrollt het invoerveld van binnen — zie director-chat.css. */
const MAX_INPUT_HEIGHT = 160;

export function DirectorChat() {
  const { user } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  // "chat" = normaal bericht aan de Director, "council" = "Vraag de Raad"
  // (stap 13). Eén gedeelde staat in plaats van twee losse booleans, zodat
  // nooit allebei tegelijk actief kunnen zijn en de typ-indicator weet welke
  // tekst te tonen.
  const [busy, setBusy] = useState<"chat" | "council" | null>(null);
  const [error, setError] = useState("");

  const listEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!user) return;

    return subscribeToChatMessages(user.uid, setMessages, (subscriptionError) => {
      setError(subscriptionError.message);
    });
  }, [user]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  // Een textarea groeit niet vanzelf mee met zijn inhoud: eerst de hoogte
  // loslaten, dan de werkelijk benodigde hoogte overnemen tot het maximum.
  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;

    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [draft]);

  const firstName = user?.displayName?.trim().split(" ")[0] ?? "";

  async function sendCurrentDraft() {
    if (!user || !draft.trim() || busy !== null) return;

    const content = draft.trim();

    setDraft("");
    setBusy("chat");
    setError("");

    try {
      await sendChatMessage(user, content);
    } catch (caught) {
      // Bij een fout komt de tekst terug in het veld, zodat een lang bericht
      // niet verloren gaat door een mislukte verzending.
      setDraft(content);
      setError(caught instanceof Error ? caught.message : "Bericht versturen is mislukt.");
    } finally {
      setBusy(null);
    }
  }

  async function askCouncilWithCurrentDraft() {
    if (!user || !draft.trim() || busy !== null) return;

    const content = draft.trim();

    setDraft("");
    setBusy("council");
    setError("");

    try {
      await askCouncil(user, content);
    } catch (caught) {
      setDraft(content);
      setError(caught instanceof Error ? caught.message : "De raad kon niet worden geraadpleegd.");
    } finally {
      setBusy(null);
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendCurrentDraft();
  }

  function useSuggestion(suggestion: string) {
    setDraft(suggestion);
    inputRef.current?.focus();
  }

  const conversationStarted = messages.length > 0;

  return (
    <section className="panel chat-panel command-center-chat dm-panel">
      <div className="section-title">
        <div>
          <h3>Chat met de Director</h3>
          <p className="muted dm-chat-subtitle">
            Jouw strategische partner voor analyse, planning en uitvoering.
          </p>
        </div>

        <span className="badge">{messages.length} BERICHTEN</span>
      </div>

      {/*
        Chatgeschiedenis staat bewust VOOR het invoerformulier hieronder: bij
        plain flex-column stacking (zie .chat-panel in globals.css) bepaalt
        de DOM-volgorde de visuele volgorde. Eerder stond het formulier hier
        eerst, waardoor het invoerveld boven de geschiedenis verscheen.
      */}
      <div className="chat-log dm-chat-log">
        {!conversationStarted && (
          /*
            Vaste begroeting, geen bericht van het model — daarom zonder
            tijdstip en zonder modelnaam eronder, en weg zodra het gesprek
            begint. Zo is niet te verwarren wat de Director echt gezegd
            heeft en wat de app zelf op het scherm zet.
          */
          <div className="dm-chat-row dm-chat-row--assistant">
            <span aria-hidden="true" className="dm-chat-avatar">
              D
            </span>

            <article className="chat-bubble chat-bubble--assistant">
              <p>
                {firstName ? `Hi ${firstName}, waarmee ` : "Waarmee "}
                kan ik je vandaag helpen?
              </p>
            </article>
          </div>
        )}

        {messages.map((message) => (
          <div className={`dm-chat-row dm-chat-row--${message.role}`} key={message.id}>
            {message.role === "assistant" && (
              <span aria-hidden="true" className="dm-chat-avatar">
                {message.model?.startsWith("council/") ? "⬡" : "D"}
              </span>
            )}

            <article className={`chat-bubble chat-bubble--${message.role}`}>
              <p>{message.content}</p>

              <small>
                {message.role === "assistant" && message.model ? `${message.model} · ` : ""}
                {message.createdAt
                  ? message.createdAt.toLocaleTimeString("nl-NL")
                  : "verzenden..."}
              </small>
            </article>
          </div>
        ))}

        {busy !== null && (
          <div className="dm-chat-row dm-chat-row--assistant">
            <span aria-hidden="true" className="dm-chat-avatar">
              {busy === "council" ? "⬡" : "D"}
            </span>

            <div
              aria-label={busy === "council" ? "De raad beraadslaagt" : "Director is aan het typen"}
              className="chat-bubble chat-bubble--assistant dm-chat-typing"
              role="status"
            >
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        <div ref={listEnd} />
      </div>

      {error && <p className="error">{error}</p>}

      {!conversationStarted && (
        <div className="dm-chat-suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button
              className="dm-chat-suggestion"
              key={suggestion}
              onClick={() => useSuggestion(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form className="chat-input-row dm-chat-input-row" onSubmit={submitMessage}>
        <textarea
          className="dm-chat-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendCurrentDraft();
            }
          }}
          placeholder="Stel je vraag aan de Director..."
          ref={inputRef}
          rows={1}
          value={draft}
        />

        <button
          aria-label="Vraag de Raad — twee onafhankelijke modellen, mogen het oneens zijn"
          className="dm-chat-council"
          disabled={busy !== null || !draft.trim()}
          onClick={() => void askCouncilWithCurrentDraft()}
          title="Vraag de Raad: twee modellen, onafhankelijk — kost meer dan een gewoon bericht"
          type="button"
        >
          <span aria-hidden="true">⬡</span>
          Vraag de Raad
        </button>

        <button
          aria-label="Verstuur bericht"
          className="dm-chat-send"
          disabled={busy !== null || !draft.trim()}
          title="Verstuur (Enter)"
        >
          <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
            <path
              d="M4 20L21 12L4 4L4 10.5L15 12L4 13.5L4 20Z"
              fill="currentColor"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      </form>
    </section>
  );
}
