"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/domains/auth/auth-provider";
import type { ChatProviderPreference } from "@/core/llm/provider-settings";

/**
 * Stap 24 — van provider wisselen zonder Vercel, zonder redeploy.
 *
 * Staat in het Systeemstatus-paneel en niet op een eigen instellingenpagina,
 * om dezelfde reden als "Jouw gebruikers-ID" daar staat: dit is het scherm
 * waarvan we weten dat Elroy het kan vinden en vertrouwt, en het staat pal
 * naast de regel die toont welke provider op dit moment actief is. Een keuze
 * maken en het resultaat zien horen bij elkaar.
 *
 * Een provider waarvan de sleutel niet is gezet, staat uitgeschakeld in plaats
 * van dat de keuze pas bij de volgende missie stukgaat. De route weigert zo'n
 * keuze óók (zie api/system/llm-provider/route.ts) — het scherm is hier de
 * vriendelijke laag, niet de enige controle.
 */
const OPTIONS: Array<{
  value: ChatProviderPreference;
  label: string;
  hint: string;
}> = [
  {
    value: "auto",
    label: "Automatisch",
    hint: "Anthropic zolang die sleutel bestaat, anders OpenAI.",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    hint: "Altijd Anthropic, ook als OpenAI beschikbaar is.",
  },
  {
    value: "openai",
    label: "OpenAI",
    hint: "Altijd OpenAI. De Anthropic-sleutel mag blijven staan, zodat de Dost Council blijft werken.",
  },
];

interface ProviderResponse {
  settings: { chatProvider: ChatProviderPreference; chatModel?: string };
  available: { anthropic: boolean; openai: boolean };
}

export function LlmProviderSwitch({ onChanged }: { onChanged?: () => void }) {
  const { user } = useAuth();

  const [data, setData] = useState<ProviderResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;

    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/system/llm-provider", {
        headers: { authorization: `Bearer ${idToken}` },
      });

      const body = (await response.json()) as ProviderResponse & { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "De providerinstelling kon niet worden opgehaald.");
      }

      setData(body);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function choose(value: ChatProviderPreference) {
    if (!user || busy || data?.settings.chatProvider === value) return;

    setBusy(true);
    setError(null);

    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/system/llm-provider", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ chatProvider: value }),
      });

      const body = (await response.json()) as ProviderResponse & { error?: string };

      if (!response.ok) {
        throw new Error(body.error ?? "De providerinstelling kon niet worden opgeslagen.");
      }

      await load();
      // De regel "LLM-provider" hierboven komt uit een andere aanroep; zonder
      // dit zou die de oude provider blijven tonen tot je het paneel opnieuw
      // opent.
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  const current = data?.settings.chatProvider ?? "auto";

  return (
    <article className="matrix-status-row">
      <div className="matrix-status-row-head">
        <strong>Actieve LLM-provider</strong>
      </div>

      <div className="matrix-provider-options">
        {OPTIONS.map((option) => {
          const unavailable =
            (option.value === "anthropic" && data && !data.available.anthropic) ||
            (option.value === "openai" && data && !data.available.openai);

          return (
            <button
              key={option.value}
              className={
                current === option.value
                  ? "matrix-provider-option matrix-provider-option--active"
                  : "matrix-provider-option"
              }
              disabled={busy || Boolean(unavailable)}
              onClick={() => void choose(option.value)}
              title={unavailable ? "De API-sleutel hiervoor is niet ingesteld." : option.hint}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <small className="matrix-status-source">
        {busy
          ? "Bezig met opslaan…"
          : OPTIONS.find((option) => option.value === current)?.hint}
      </small>

      {error && <p className="matrix-status-error">{error}</p>}
    </article>
  );
}
