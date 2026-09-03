"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/domains/auth/auth-provider";
import {
  approveAndMergeMissionV2,
  autoStepMissionV2,
  cancelMissionV2,
  createMissionV2,
  listMissionsV2,
} from "@/domains/missions/mission-engine-v2-service";
import type { MissionRiskLevel, MissionV2 } from "@/core/mission-engine/v2/mission";
import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";

import "./mission-engine-v2-panel.css";

/**
 * Mission Engine V2: hier kun je een mission aanmaken en de Director zelf
 * laten beslissen wat de eerstvolgende stap is — inclusief het écht laten
 * uitvoeren van die stap door de builder-rol (een echte LLM-aanroep), met
 * gebruik van goedgekeurde kennis uit het Second Brain als achtergrond.
 *
 * Twee weergaven, via de `variant`-prop, met dezelfde onderliggende logica
 * (geen losse code om uit elkaar te laten lopen):
 * - "full"    → de oorspronkelijke testpagina (/dashboard/missions-v2):
 *               uitleg, missielijst én het handmatige aanmaakformulier.
 * - "compact" → het hoofdscherm (Command Center): alleen een kort
 *               statusoverzicht van de meest recente missie plus de
 *               "volgende stap"-knop, zonder uitleg, lijst of formulier —
 *               zodat het hoofdscherm rustig blijft. Voor het aanmaken van
 *               een nieuwe missie verwijst dit naar de volledige pagina.
 *               (Zodra de chat straks zelf missies aanmaakt, is dat
 *               handmatige formulier daar toch niet meer de hoofdroute.)
 *
 * Let op (opmaak van het aanmaakformulier): de titel- en doel-velden staan
 * elk in hun eigen `mission-engine-v2-form-group`-wrapper (display:block,
 * width:100%) zodat ze de volledige paneelbreedte gebruiken in plaats van
 * naast elkaar in een smalle kolom te staan. Het succescriteria-veld is een
 * `<textarea>` met de klasse `mission-engine-v2-form-textarea`
 * (min-height + width:100%) en de submitknop staat als laatste child van dat
 * formulier, met de extra klasse `mission-engine-v2-form-submit-block`
 * (display:block, width:100%) naast de bestaande `mission-engine-v2-form-submit`-klasse.
 * Dit is bewust losgekoppeld van de elders gebruikte gedeelde stijlklasse
 * voor een los invoerveld-plus-knop, zodat die daar ongemoeid blijft. De
 * bijbehorende stijlregels staan in ./mission-engine-v2-panel.css, dat
 * hierboven expliciet wordt geïmporteerd zodat deze klassen ook
 * daadwerkelijk effect hebben.
 *
 * Layout van de "full"-variant (bovenaan de pagina /dashboard/missions-v2):
 * de twee hoofdpanelen ("Nieuwe missie aanmaken" en "Director & Uitvoering")
 * staan naast elkaar in een eigen, uitsluitend aan dit component gebonden
 * `mev2-top-grid`-container (twee kolommen: `mev2-col mev2-col-form` en
 * `mev2-col mev2-col-director`, zie ./mission-engine-v2-panel.css). Deze
 * klassen zijn bewust NIET de gedeelde `command-center-main-grid`-klasse die
 * elders op het dashboard wordt gebruikt: zo kan deze layout onafhankelijk en
 * proportioneel (met fr-eenheden, zonder vaste pixel-minimumbreedtes)
 * meeschalen bij het in- en uitzoomen, zonder andere schermen te
 * beïnvloeden. Binnen elke kolom staat de inhoud verticaal onder elkaar
 * (`mev2-col-body`) met de bijbehorende actieknop als laatste element
 * onderaan de kolom. Het `<form className="mev2-col-body">` van kolom 1 is
 * zelf een flex-kolom (zie CSS: display:flex, flex-direction:column,
 * flex-grow:1) die de volledige hoogte van `.mev2-col` inneemt; vlak vóór de
 * submitknop staat daarom een `<div className="mev2-col-spacer" />` die de
 * overgebleven ruimte opvult, zodat "Mission aanmaken en starten" altijd
 * onderaan de kolom uitlijnt — net als de "volgende stap"-knop in kolom 2,
 * die met dezelfde `.mev2-col-submit`-klasse werkt. Kolom 2 zelf
 * (`mev2-col mev2-col-director`) is eveneens een flex-kolom: de
 * status/missiekaart/Director-beslissing/gebruikte kennis/laatste
 * rolresultaat staan samen in `.mev2-col-body` (dat de resterende ruimte
 * opvult), en de "Laat de Director de volgende stap zetten"-knop staat
 * daarna, als laatste child van `.mev2-col`, met de `.mev2-col-submit`-klasse
 * zodat hij gegarandeerd onderaan de kolom blijft — analoog aan kolom 1. Het
 * "Recente missies"-blok staat hierónder, ná de `mev2-top-grid`-wrapper, in
 * een bewust minder prominente `mev2-recent-missions`-wrapper.
 */

const AUTO_STEP_STATUSES: MissionV2["status"][] = ["ACTIVE", "WAITING_FOR_ROLE"];

/**
 * Missies in een van deze statussen kunnen nog geannuleerd worden (zie
 * state-machine.ts: CANCELLED is vanuit vrijwel elke niet-afgeronde status
 * een geldige transitie). COMPLETED/FAILED/CANCELLED zijn eindstatussen
 * waar niets meer te annuleren valt.
 */
const CANCELLABLE_STATUSES: MissionV2["status"][] = [
  "DRAFT",
  "READY",
  "ACTIVE",
  "WAITING_FOR_ROLE",
  "WAITING_FOR_OWNER",
  "WAITING_FOR_APPROVAL",
  "REPLANNING",
  "PAUSED",
];

function statusLabel(status: MissionV2["status"]): string {
  const labels: Record<MissionV2["status"], string> = {
    DRAFT: "Concept",
    READY: "Klaar om te starten",
    ACTIVE: "Actief",
    WAITING_FOR_ROLE: "Wacht op rol-uitvoering",
    WAITING_FOR_OWNER: "Wacht op jouw input",
    WAITING_FOR_APPROVAL: "Wacht op jouw goedkeuring",
    REPLANNING: "Wordt herpland",
    PAUSED: "Gepauzeerd",
    COMPLETED: "Voltooid",
    FAILED: "Mislukt",
    CANCELLED: "Geannuleerd",
  };

  return labels[status] ?? status;
}

/**
 * Toont de geschatte kosten van een missie tot nu toe — puur informatief.
 * `mission.spentCost` wordt berekend in USD (zie pricing.ts/usage-tracker.ts
 * in de mission engine), terwijl het budget van de missie standaard in EUR
 * staat (zie mission-factory.ts) — bewust GEEN valuta-omrekening tussen die
 * twee (zie de toelichting in pricing.ts), dus dit toont beide bedragen naast
 * elkaar in hun eigen valuta in plaats van een schijnnauwkeurige vergelijking
 * te suggereren. Blokkeert nooit iets (zie de eigenaar-keuze in mission.ts) —
 * puur zichtbaarheid.
 */
function formatMissionCost(mission: MissionV2): string {
  const spent = mission.spentCost.toLocaleString("nl-NL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });

  return `~$${spent} geschat (budget: ${mission.budget.maximumCost} ${mission.budget.currency}, indicatief — blokkeert niets)`;
}

/**
 * Keuzelijst voor het riskLevel-veld in het aanmaakformulier. LOW staat
 * bewust eerst (en is de standaardwaarde, zie useState hieronder) — dat
 * levert precies hetzelfde gedrag op als vóór dit veld bestond
 * (classifyPullRequestRiskForMission in risk-classification.ts laat bij LOW
 * de bestandsgebaseerde classificatie ongewijzigd).
 */
const RISK_LEVELS: MissionRiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/**
 * Herkenningstekst uit de foutmelding die de Director geeft wanneer hij een
 * gehaalde missie niet automatisch mag mergen (zie
 * classifyPullRequestRiskForMission/ensureMissionPullRequestMerged in
 * director-runtime.ts — deze exacte tekst staat in beide needs-signoff-
 * foutmeldingen, ongeacht of dat door de bestandsgebaseerde classificatie of
 * door het missie-risiconiveau komt). Er is geen structureel foutveld in de
 * API-respons (net als bij alle andere acties hier — zie route.ts), dus dit
 * is bewust een gerichte tekstherkenning op precies díe foutmelding, niet op
 * fouten in het algemeen: laat de "Goedkeuring & Mergen"-knop (roadmap-stap
 * 4) alleen verschijnen wanneer die specifieke situatie zich voordoet.
 */
const NEEDS_SIGNOFF_MARKER = "risicoclassificatie: needs-signoff";

function riskLevelLabel(level: MissionRiskLevel): string {
  const labels: Record<MissionRiskLevel, string> = {
    LOW: "Laag — automatisch mergen blijft mogelijk bij een geïsoleerde wijziging",
    MEDIUM: "Middel — altijd jouw eigen goedkeuring vóór mergen",
    HIGH: "Hoog — altijd jouw eigen goedkeuring vóór mergen",
    CRITICAL: "Kritiek — altijd jouw eigen goedkeuring vóór mergen",
  };

  return labels[level];
}

export interface MissionEngineV2PanelProps {
  variant?: "full" | "compact";
}

export function MissionEngineV2Panel({ variant = "full" }: MissionEngineV2PanelProps) {
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [successCriteriaText, setSuccessCriteriaText] = useState("");
  const [riskLevel, setRiskLevel] = useState<MissionRiskLevel>("LOW");

  const [recentMissions, setRecentMissions] = useState<MissionV2[]>([]);
  const [mission, setMission] = useState<MissionV2 | null>(null);
  const [roleOutput, setRoleOutput] = useState("");
  const [directorReason, setDirectorReason] = useState("");
  const [usedKnowledge, setUsedKnowledge] = useState<KnowledgeEntry[]>([]);

  // Roadmap-stap 4 ("Goedkeuring & Mergen"): needsApproval bepaalt of die
  // knop zichtbaar is (zie NEEDS_SIGNOFF_MARKER hierboven), approveInfo toont
  // het resultaat ná een geslaagde klik erop.
  const [needsApproval, setNeedsApproval] = useState(false);
  const [approveInfo, setApproveInfo] = useState("");

  const [busy, setBusy] = useState<"create" | "auto-step" | "cancel" | "approve" | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    (async () => {
      try {
        const missions = await listMissionsV2(user, 5);
        if (cancelled) return;

        setRecentMissions(missions);

        // Toon standaard de meest recent bijgewerkte missie, zodat je bij
        // terugkomst op het hoofdscherm niet elke keer opnieuw hoeft te
        // beginnen.
        if (missions.length > 0) {
          setMission(missions[0]);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Missies ophalen is mislukt.");
        }
      } finally {
        if (!cancelled) setLoadingRecent(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  function resetFeedback() {
    setRoleOutput("");
    setDirectorReason("");
    setUsedKnowledge([]);
    setNeedsApproval(false);
    setApproveInfo("");
  }

  function selectMission(candidate: MissionV2) {
    setMission(candidate);
    resetFeedback();
    setError("");
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user) return;

    const successCriteria = successCriteriaText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!title.trim() || !objective.trim() || successCriteria.length === 0) {
      setError("Vul een titel, doel en minimaal één succescriterium in.");
      return;
    }

    setBusy("create");
    setError("");
    resetFeedback();

    try {
      const created = await createMissionV2(user, {
        title: title.trim(),
        objective: objective.trim(),
        successCriteria,
        riskLevel,
      });
      setMission(created);
      setRecentMissions((current) => [created, ...current].slice(0, 5));
      setTitle("");
      setObjective("");
      setSuccessCriteriaText("");
      setRiskLevel("LOW");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Mission aanmaken is mislukt.");
    } finally {
      setBusy(null);
    }
  }

  async function handleAutoStep() {
    if (!user || !mission) return;

    setBusy("auto-step");
    setError("");
    setNeedsApproval(false);
    setApproveInfo("");

    try {
      const result = await autoStepMissionV2(user, mission.missionId);
      setMission(result.mission);
      setRecentMissions((current) =>
        current.map((entry) => (entry.missionId === result.mission.missionId ? result.mission : entry)),
      );
      if (result.decision) setDirectorReason(result.decision.reason);
      if (result.roleOutput) setRoleOutput(result.roleOutput);
      setUsedKnowledge(result.usedKnowledge ?? []);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "De Director kon geen stap zetten.";
      setError(message);
      // Zie NEEDS_SIGNOFF_MARKER hierboven: toon de "Goedkeuring & Mergen"-
      // knop precies wanneer dít de reden is dat de stap niet doorging.
      setNeedsApproval(message.includes(NEEDS_SIGNOFF_MARKER));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Roadmap-stap 4: mergt de pull request van de missie rechtstreeks vanuit
   * de app, zonder naar GitHub.com te hoeven — zie approveAndMergeMissionV2
   * en de achtergrond in director-runtime.ts. Verandert de mission zelf niet
   * (alleen de pull request op GitHub); de eigenaar klikt daarna gewoon
   * opnieuw op "volgende stap" om de missie daadwerkelijk af te ronden.
   */
  async function handleApproveAndMerge() {
    if (!user || !mission) return;

    setBusy("approve");
    setError("");

    try {
      const result = await approveAndMergeMissionV2(user, mission.missionId);
      setNeedsApproval(false);
      setApproveInfo(
        `Pull request #${result.pullRequestNumber} is gemerged. Klik nogmaals op "Laat de Director de volgende stap zetten" om de missie af te ronden: ${result.pullRequestUrl}`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Goedkeuren en mergen is mislukt.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Annuleert de geselecteerde mission (bijvoorbeeld eentje die muurvast zit
   * in needs-signoff met een pull request die je liever niet via de Director
   * laat oplossen). Vraagt eerst expliciet bevestiging — dit is niet terug
   * te draaien (CANCELLED is een eindstatus, zie state-machine.ts).
   */
  async function handleCancel() {
    if (!user || !mission) return;

    const confirmed = window.confirm(
      `Missie "${mission.title}" annuleren? Dit kan niet ongedaan worden gemaakt.`,
    );
    if (!confirmed) return;

    setBusy("cancel");
    setError("");

    try {
      const updated = await cancelMissionV2(user, mission.missionId);
      setMission(updated);
      setRecentMissions((current) =>
        current.map((entry) => (entry.missionId === updated.missionId ? updated : entry)),
      );
      resetFeedback();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Mission annuleren is mislukt.");
    } finally {
      setBusy(null);
    }
  }

  const canAutoStep = mission && AUTO_STEP_STATUSES.includes(mission.status);
  const canCancel = mission && CANCELLABLE_STATUSES.includes(mission.status);

  // Gedeeld tussen beide weergaven: de missiekaart en de feedback van de
  // laatste stap (Director-beslissing, gebruikte kennis, resultaat van de
  // builder-rol). De "volgende stap"-knop zelf staat hier bewust NIET in,
  // zodat we die in de "full"-variant als allerlaatste element van de
  // "Director & Uitvoering"-kolom kunnen plaatsen (ná alle statusinformatie).
  const progressDetails = loadingRecent ? (
    <div className="empty">Missies worden geladen...</div>
  ) : !mission ? (
    <div className="empty">
      {variant === "compact" ? (
        <>
          Nog geen mission aangemaakt.{" "}
          <Link href="/dashboard/missions-v2">Maak er hier een aan</Link>.
        </>
      ) : (
        "Nog geen mission aangemaakt."
      )}
    </div>
  ) : (
    <div className="mission-list">
      <article className="mission-card">
        <div>
          <span className="mission-status">{statusLabel(mission.status)}</span>
          <p>{mission.title}</p>
          {/*
            Bewust een <p> in plaats van <small>: de gedeelde stijl
            `.mission-card small { white-space: nowrap }` (globals.css) is
            bedoeld voor korte labels (zoals "versie X · Y toewijzingen"
            hieronder), niet voor een volledige, mogelijk lange
            doelomschrijving. Met <small> werd die tekst gedwongen op één
            regel gezet en afgekapt zodra de kolom smaller was dan de
            volledige zin. `.mission-card p` bestaat al en breekt gewoon af.
          */}
          <p className="mission-objective">{mission.objective}</p>
        </div>

        {/*
          Beide <small>-regels samen in één wrapper: .mission-card is
          display:flex met justify-content:space-between over precies twee
          kinderen (dit blok en het <div> hierboven) — een derde direct kind
          zou die twee-kolomsverdeling verstoren.
        */}
        <div className="mev2-card-meta">
          <small>
            versie {mission.version} · {mission.assignments.length} toewijzing(en)
          </small>
          {/*
            Alleen tonen bij MEDIUM/HIGH/CRITICAL, niet bij LOW: LOW is de
            standaardwaarde voor vrijwel elke missie en levert exact het
            gedrag van vóór dit veld bestond op (zie
            classifyPullRequestRiskForMission), dus een label erbij zou hier
            alleen ruis toevoegen zonder iets bijzonders te melden.
          */}
          {mission.riskLevel !== "LOW" && (
            <small className="mev2-risk">Risiconiveau: {mission.riskLevel} (altijd jouw goedkeuring vóór mergen)</small>
          )}
          <small className="mev2-cost">{formatMissionCost(mission)}</small>
        </div>
      </article>

      {!canAutoStep && mission.status !== "COMPLETED" && (
        <p className="muted">
          De Director kan hier nog niet automatisch mee verder (status: {statusLabel(mission.status)}).
        </p>
      )}

      {mission.status === "COMPLETED" && <p className="muted">Deze missie is voltooid.</p>}

      {approveInfo && (
        <article className="knowledge-card">
          <strong>Goedkeuring &amp; Mergen</strong>
          <p>{approveInfo}</p>
        </article>
      )}

      {directorReason && (
        <article className="knowledge-card">
          <strong>Beslissing van de Director</strong>
          <p>{directorReason}</p>
        </article>
      )}

      {usedKnowledge.length > 0 && (
        <article className="knowledge-card">
          <strong>Gebruikte kennis uit het Second Brain</strong>
          <ul>
            {usedKnowledge.map((entry) => (
              <li key={entry.id}>{entry.title?.trim() || "(zonder titel)"}</li>
            ))}
          </ul>
        </article>
      )}

      {roleOutput && (
        <article className="knowledge-card">
          <strong>Resultaat van de laatst uitgevoerde rol</strong>
          <p>{roleOutput}</p>
        </article>
      )}
    </div>
  );

  const autoStepButton = mission ? (
    <div className="command-center-quick-command mev2-col-submit">
      <button
        className="primary"
        type="button"
        disabled={!canAutoStep || busy !== null}
        onClick={() => void handleAutoStep()}
      >
        {busy === "auto-step" ? "Director is bezig..." : "Laat de Director de volgende stap zetten"}
      </button>

      {/*
        Roadmap-stap 4: verschijnt uitsluitend na een needs-signoff-
        foutmelding (zie NEEDS_SIGNOFF_MARKER/handleAutoStep hierboven) —
        vervangt het handmatig mergen op GitHub.com, zonder de onderliggende
        vangnetten (alle criteria GEHAALD + CI geslaagd, zie
        approveAndMergeMissionPullRequest in director-runtime.ts) te omzeilen.
      */}
      {needsApproval && (
        <button
          className="secondary"
          type="button"
          disabled={busy !== null}
          onClick={() => void handleApproveAndMerge()}
        >
          {busy === "approve" ? "Bezig met mergen..." : "Goedkeuring & Mergen"}
        </button>
      )}

      {/*
        Bewust een losse, minder prominente knop (`.secondary`, al bestaande
        stijl uit globals.css) naast de primaire "volgende stap"-knop, niet
        ervoor of eronder als hoofdactie: annuleren is een uitzondering
        (bijvoorbeeld een missie die muurvast zit in needs-signoff met een
        pull request die je liever niet via de Director oplost), geen
        onderdeel van de normale flow.
      */}
      {canCancel && (
        <button
          className="secondary"
          type="button"
          disabled={busy !== null}
          onClick={() => void handleCancel()}
        >
          {busy === "cancel" ? "Bezig..." : "Missie annuleren"}
        </button>
      )}
    </div>
  ) : null;

  if (variant === "compact") {
    return (
      <section className="panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">MISSION ENGINE V2</p>
            <h3>Director &amp; uitvoering</h3>
          </div>

          {mission && <span className="badge">{statusLabel(mission.status)}</span>}
        </div>

        {progressDetails}
        {autoStepButton}

        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <>
      <section className="panel command-center-intro">
        <div>
          <p className="eyebrow">MISSION ENGINE V2</p>
          <h1>Mission Engine — zelfstandige Director</h1>
          <p className="muted">
            Missies worden echt opgeslagen (Firestore). Eén knop laat de
            Director zelf beslissen wat de eerstvolgende stap is — en voert
            die (bij een dispatch naar de builder-rol) meteen ook uit via een
            echte LLM-aanroep. De Director gebruikt daarbij ook goedgekeurde
            kennis uit je Second Brain als achtergrond.
          </p>
        </div>
      </section>

      {/*
        Nieuwe, uitsluitend aan deze pagina gebonden wrapper: plaatst de twee
        hoofdpanelen naast elkaar (CSS Grid, twee gelijke kolommen, gap in
        rem — zie mission-engine-v2-panel.css). Deze klasse is bewust géén
        alias voor `command-center-main-grid`, zodat die layout elders
        onaangeroerd blijft.
      */}
      <section className="mev2-top-grid">
        <div className="panel mev2-col mev2-col-form">
          <div className="section-title">
            <div>
              <p className="eyebrow">NIEUWE MISSION</p>
              <h3>Aanmaken</h3>
            </div>
          </div>

          <form className="mission-create-form mev2-col-body" onSubmit={submitCreate}>
            <div className="mission-engine-v2-form-group">
              <input
                className="mission-engine-v2-form-field"
                placeholder="Titel"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="mission-engine-v2-form-group">
              <input
                className="mission-engine-v2-form-field"
                placeholder="Doel (wat moet er bereikt worden?)"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
              />
            </div>

            <div className="mission-engine-v2-form-group">
              <textarea
                className="mission-engine-v2-form-textarea"
                rows={6}
                placeholder={"Succescriteria, één per regel"}
                value={successCriteriaText}
                onChange={(event) => setSuccessCriteriaText(event.target.value)}
              />
            </div>

            {/*
              Risiconiveau van de missie zelf — zie
              classifyPullRequestRiskForMission in risk-classification.ts.
              Bewust een simpele <select> met de mission-engine-v2-form-field-
              klasse (net als de tekstvelden hierboven), geen nieuwe stijl
              nodig.
            */}
            <div className="mission-engine-v2-form-group">
              <label className="mev2-risk-label" htmlFor="mev2-risk-level">
                Risiconiveau van deze missie
              </label>
              <select
                id="mev2-risk-level"
                className="mission-engine-v2-form-field"
                value={riskLevel}
                onChange={(event) => setRiskLevel(event.target.value as MissionRiskLevel)}
              >
                {RISK_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level} — {riskLevelLabel(level)}
                  </option>
                ))}
              </select>
            </div>

            {/*
              Vult de resterende ruimte in deze flex-kolom op, zodat de
              submitknop hieronder altijd onderaan de kolom uitlijnt — ook
              als de andere kolom (Director & Uitvoering) meer inhoud heeft
              en dus hoger is.
            */}
            <div className="mev2-col-spacer" />

            <button
              className="primary mission-engine-v2-form-submit mission-engine-v2-form-submit-block mev2-col-submit"
              disabled={busy === "create"}
            >
              {busy === "create" ? "Bezig..." : "Mission aanmaken en starten"}
            </button>
          </form>
        </div>

        <div className="panel mev2-col mev2-col-director">
          <div className="section-title">
            <div>
              <p className="eyebrow">DIRECTOR &amp; UITVOERING</p>
              <h3>Voortgang</h3>
            </div>

            {mission && <span className="badge">{statusLabel(mission.status)}</span>}
          </div>

          {/*
            Status, missiekaart, Director-beslissing, gebruikte kennis en het
            resultaat van de laatst uitgevoerde rol staan hier samen
            verticaal onder elkaar (`progressDetails`), binnen dezelfde
            flex-kolom-body als kolom 1. De "volgende stap"-knop
            (`autoStepButton`, met `.mev2-col-submit`) staat hierna, en komt
            zo — net als in kolom 1 — gegarandeerd onderaan de kolom te
            staan. Een eventuele foutmelding (bijv. een needs-signoff-melding
            van de Director, of een mislukte stap) staat expres hierna, dus
            direct ONDER die knop in plaats van helemaal onderaan de pagina
            (na "Recente missies") — zodat de melding zichtbaar blijft bij de
            actie die haar veroorzaakte.
          */}
          <div className="mev2-col-body">{progressDetails}</div>

          {autoStepButton}
          {error && <p className="error">{error}</p>}
        </div>
      </section>

      {/*
        Het "Recente missies"-blok staat bewust NÁ (onder) de
        `mev2-top-grid`-wrapper hierboven, en krijgt via `mev2-recent-missions`
        een merkbaar minder prominente stijl (kleinere koppen, gedempte
        kleuren, minder padding — zie mission-engine-v2-panel.css) dan de
        twee kolommen erboven.
      */}
      {recentMissions.length > 1 && (
        <section className="panel mev2-recent-missions">
          <div className="section-title mev2-recent-missions__header">
            <div>
              <p className="eyebrow mev2-recent-missions__eyebrow">RECENTE MISSIES</p>
              <h3 className="mev2-recent-missions__title">Kies een missie</h3>
            </div>
          </div>

          <div className="mission-list mev2-recent-missions__list">
            {recentMissions.map((candidate) => (
              <button
                key={candidate.missionId}
                type="button"
                className={
                  mission?.missionId === candidate.missionId
                    ? "mission-card mission-card--active mev2-recent-missions__item"
                    : "mission-card mev2-recent-missions__item"
                }
                onClick={() => selectMission(candidate)}
              >
                <span className="mission-status">{statusLabel(candidate.status)}</span>
                <p>{candidate.title}</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}