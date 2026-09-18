"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";
import { useAuth } from "@/domains/auth/auth-provider";
import {
  EMPTY_FILTERS,
  applyFilters,
  collectFacets,
  entrySourceLabel,
  type KnowledgeFilters,
  type KnowledgePeriod,
} from "@/domains/knowledge/knowledge-filters";
import { subscribeToApprovedKnowledge } from "@/domains/knowledge/knowledge-service";
import {
  knowledgeTypeIcon,
  knowledgeTypeLabel,
} from "@/domains/knowledge/knowledge-type-labels";

import "@/app/dashboard/second-brain/second-brain.css";

/**
 * Stap 20 — de doorzoekbare Second Brain.
 *
 * WAAROM DIT EEN EIGEN PAGINA IS
 *
 * De roadmap sprak van "binnen Command Center", maar dat scherm is inmiddels
 * drie volle kolommen (chat, Mission Engine, uitvoering). In dashboard/page.tsx
 * staat sinds de herindeling letterlijk dat het Second Brain-paneel daar is
 * weggehaald en "een eigen plek krijgt zodra de doorzoekbare weergave er is",
 * en in matrix-navigation.ts stond deze pagina al klaar als gepland item. Dit
 * is die plek.
 *
 * WAT HET WEL EN NIET IS
 *
 * Dit is een leesscherm. Beoordelen, bewerken en afwijzen blijven op de
 * Knowledge-pagina, waar de wachtrij staat. Hier zie je uitsluitend wat het
 * systeem daadwerkelijk wéét — de goedgekeurde kennis waar de Director zijn
 * beslissingen op baseert. Twee schermen die allebei kunnen bewerken, is twee
 * plekken waar iets fout kan gaan.
 *
 * De rangschikking bij een zoekterm komt uit relevance.ts: exact dezelfde
 * berekening waarmee de Director kennis bij een missie betrekt. Wat jij hier
 * bovenaan ziet, is wat hij ook bovenaan zou zien.
 */

const PERIOD_LABELS: Record<KnowledgePeriod, string> = {
  all: "Alles",
  week: "Afgelopen week",
  month: "Afgelopen maand",
  quarter: "Afgelopen kwartaal",
};

function toggle(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function formatDate(date: Date | null): string {
  if (!date) return "datum onbekend";

  return date.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

interface FacetRowProps {
  label: string;
  options: { value: string; count: number }[];
  selected: string[];
  formatValue?: (value: string) => string;
  onToggle: (value: string) => void;
}

function FacetRow({ label, options, selected, formatValue, onToggle }: FacetRowProps) {
  if (options.length === 0) return null;

  return (
    <div className="sb-facet">
      <span className="sb-facet-label">{label}</span>

      <div className="sb-facet-chips">
        {options.map((option) => (
          <button
            key={option.value}
            className={`sb-chip${selected.includes(option.value) ? " sb-chip--on" : ""}`}
            onClick={() => onToggle(option.value)}
            type="button"
          >
            {formatValue ? formatValue(option.value) : option.value}
            <span className="sb-chip-count">{option.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SecondBrainPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<KnowledgeFilters>(EMPTY_FILTERS);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;

    return subscribeToApprovedKnowledge(
      user.uid,
      (next) => {
        setEntries(next);
        setError("");
      },
      (caught) => setError(caught.message),
    );
  }, [user]);

  // De keuzes komen uit álle goedgekeurde kennis en niet uit het gefilterde
  // resultaat. Zouden ze meebewegen, dan verdwijnt de knop waarmee je een
  // filter weer uit zou zetten zodra hij aanstaat.
  const facets = useMemo(() => collectFacets(entries), [entries]);

  const results = useMemo(() => applyFilters(entries, filters), [entries, filters]);

  const hasFilters =
    filters.query.trim().length > 0 ||
    filters.types.length > 0 ||
    filters.sources.length > 0 ||
    filters.tags.length > 0 ||
    filters.period !== "all";

  if (loading || !user) {
    return <main className="center-screen">Second Brain wordt geladen...</main>;
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SECOND BRAIN</p>
          <h1>Wat de Matrix weet</h1>
        </div>

        <div className="top-actions">
          <button className="secondary" onClick={() => router.push("/dashboard")} type="button">
            Dashboard
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">ZOEKEN EN FILTEREN</p>
            <h3>Goedgekeurde kennis</h3>
          </div>

          <span className="badge">{entries.length}</span>
        </div>

        <div className="sb-toolbar">
          <div className="sb-search">
            <input
              onChange={(event) =>
                setFilters((current) => ({ ...current, query: event.target.value }))
              }
              placeholder="Waar zoek je naar? Bijvoorbeeld: waarom werken agents via GitHub"
              type="search"
              value={filters.query}
            />
          </div>

          <FacetRow
            label="Soort"
            onToggle={(value) =>
              setFilters((current) => ({ ...current, types: toggle(current.types, value) }))
            }
            options={facets.types}
            formatValue={(value) => `${knowledgeTypeIcon(value)} ${knowledgeTypeLabel(value)}`}
            selected={filters.types}
          />

          <FacetRow
            label="Herkomst"
            onToggle={(value) =>
              setFilters((current) => ({ ...current, sources: toggle(current.sources, value) }))
            }
            options={facets.sources}
            selected={filters.sources}
          />

          <FacetRow
            label="Onderwerp"
            onToggle={(value) =>
              setFilters((current) => ({ ...current, tags: toggle(current.tags, value) }))
            }
            options={facets.tags}
            selected={filters.tags}
          />

          <div className="sb-facet">
            <span className="sb-facet-label">Periode</span>

            <div className="sb-facet-chips">
              {(Object.keys(PERIOD_LABELS) as KnowledgePeriod[]).map((period) => (
                <button
                  key={period}
                  className={`sb-chip${filters.period === period ? " sb-chip--on" : ""}`}
                  onClick={() => setFilters((current) => ({ ...current, period }))}
                  type="button"
                >
                  {PERIOD_LABELS[period]}
                </button>
              ))}
            </div>
          </div>

          <div className="sb-summary">
            <span>
              {results.length} van {entries.length} kennisitem
              {entries.length === 1 ? "" : "s"}
              {filters.query.trim() ? " · gerangschikt op relevantie" : " · nieuwste eerst"}
            </span>

            <button
              className="sb-clear"
              disabled={!hasFilters}
              onClick={() => setFilters(EMPTY_FILTERS)}
              type="button"
            >
              Filters wissen
            </button>
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="sb-results">
          {results.length === 0 ? (
            <div className="empty">
              {entries.length === 0
                ? "Er staat nog geen goedgekeurde kennis in het Second Brain. Wat je op de Knowledge-pagina goedkeurt, komt hier terecht."
                : "Geen kennisitem past bij deze combinatie. Probeer een filter uit te zetten of anders te zoeken."}
            </div>
          ) : (
            results.map((entry) => (
              <article className="knowledge-card" key={entry.id}>
                <div className="sb-result-head">
                  <strong>{entry.title?.trim() || "Kennisitem"}</strong>

                  <span className="sb-result-type">
                    {knowledgeTypeIcon(entry.type)} {knowledgeTypeLabel(entry.type)}
                  </span>
                </div>

                <p>{entry.summary?.trim() || entry.content}</p>

                {entry.tags.length > 0 && (
                  <div className="sb-result-tags">
                    {entry.tags.map((tag) => (
                      <span className="sb-result-tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <small>
                  <span className="sb-result-source">{entrySourceLabel(entry)}</span> ·{" "}
                  {formatDate(entry.createdAt)}
                </small>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
