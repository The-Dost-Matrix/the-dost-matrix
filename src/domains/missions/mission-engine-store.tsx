"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { KnowledgeEntry } from "@/core/domain/knowledge/knowledge-entry";
import type { MissionRiskLevel, MissionV2 } from "@/core/mission-engine/v2/mission";
import { useAuth } from "@/domains/auth/auth-provider";
import {
  approveAndMergeMissionV2,
  autoStepMissionV2,
  cancelMissionV2,
  createMissionV2,
  listMissionsV2,
  type MissionEngineApiError,
} from "@/domains/missions/mission-engine-v2-service";

/**
 * Gedeelde toestand van de Mission Engine.
 *
 * Waarom dit bestaat: alle state (missies, geselecteerde missie, de
 * formuliervelden, welke knop bezig is, de laatste Director-beslissing) zat
 * opgesloten in één component van bijna 30 KB. Daardoor moesten het
 * aanmaakformulier, de uitvoering, de voortgang en de missielijst
 * onvermijdelijk in datzelfde component blijven wonen — je kon ze niet als
 * losse panelen op een pagina zetten, laat staan verplaatsen.
 *
 * Met deze provider is een paneel niet meer dan een weergave zonder eigen
 * props: het haalt wat het nodig heeft uit `useMissionEngine()`. Een pagina
 * is daarmee alleen nog een indeling, en een paneel verplaatsen kost één
 * regel JSX.
 */

const AUTO_STEP_STATUSES: MissionV2["status"][] = ["ACTIVE", "WAITING_FOR_ROLE"];

/**
 * Missies in een van deze statussen kunnen nog geannuleerd worden (zie
 * state-machine.ts: CANCELLED is vanuit vrijwel elke niet-afgeronde status
 * een geldige transitie). COMPLETED/FAILED/CANCELLED zijn eindstatussen.
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

/**
 * Machineleesbare foutcode die de Director meegeeft wanneer hij een gehaalde
 * missie niet automatisch mag mergen (zie DirectorRuntimeError in
 * director-runtime.ts — stap 5: gestructureerde foutcodes in plaats van
 * string-matching op de mensleesbare melding).
 */
const NEEDS_SIGNOFF_CODE = "NEEDS_SIGNOFF";

/**
 * Hoeveel missies de lijst ophaalt, gesorteerd op laatst bijgewerkt.
 *
 * Stond op 5. Dat leverde een echt gat op: er is geen knop om verder te
 * bladeren, dus een missie die niet bij de vijf laatst bijgewerkte hoort was
 * via de UI onbereikbaar — ook als hij nog ACTIVE was en dus alleen dáár
 * geannuleerd kon worden. Twintig is het maximum dat de API-route accepteert
 * (zie app/api/missions/v2/route.ts); hoger vragen valt daar terug op vijf.
 *
 * Dit is bewust geen echte paginering: dat is pas de moeite waard als
 * twintig ook te weinig blijkt.
 */
const MISSION_LIST_LIMIT = 20;

export type MissionEngineBusyAction = "create" | "auto-step" | "cancel" | "approve" | null;

export interface MissionEngineState {
  missions: MissionV2[];
  mission: MissionV2 | null;
  loadingMissions: boolean;
  busy: MissionEngineBusyAction;
  error: string;

  roleOutput: string;
  directorReason: string;
  usedKnowledge: KnowledgeEntry[];
  needsApproval: boolean;
  approveInfo: string;

  canAutoStep: boolean;
  canCancel: boolean;

  form: {
    title: string;
    objective: string;
    successCriteriaText: string;
    riskLevel: MissionRiskLevel;
    setTitle: (value: string) => void;
    setObjective: (value: string) => void;
    setSuccessCriteriaText: (value: string) => void;
    setRiskLevel: (value: MissionRiskLevel) => void;
  };

  selectMission: (mission: MissionV2) => void;
  createMission: () => Promise<void>;
  autoStep: () => Promise<void>;
  approveAndMerge: () => Promise<void>;
  cancelMission: () => Promise<void>;
}

const MissionEngineContext = createContext<MissionEngineState | null>(null);

export function useMissionEngine(): MissionEngineState {
  const value = useContext(MissionEngineContext);

  if (!value) {
    throw new Error(
      "useMissionEngine() is gebruikt buiten een <MissionEngineProvider>. Wikkel de pagina (of het paneel) daarin.",
    );
  }

  return value;
}

export function MissionEngineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [successCriteriaText, setSuccessCriteriaText] = useState("");
  const [riskLevel, setRiskLevel] = useState<MissionRiskLevel>("LOW");

  const [missions, setMissions] = useState<MissionV2[]>([]);
  const [mission, setMission] = useState<MissionV2 | null>(null);
  const [roleOutput, setRoleOutput] = useState("");
  const [directorReason, setDirectorReason] = useState("");
  const [usedKnowledge, setUsedKnowledge] = useState<KnowledgeEntry[]>([]);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [approveInfo, setApproveInfo] = useState("");

  const [busy, setBusy] = useState<MissionEngineBusyAction>(null);
  const [loadingMissions, setLoadingMissions] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    void (async () => {
      try {
        const loaded = await listMissionsV2(user, MISSION_LIST_LIMIT);
        if (cancelled) return;

        setMissions(loaded);

        // Toon standaard de meest recent bijgewerkte missie, zodat je bij
        // terugkomst niet elke keer opnieuw hoeft te kiezen.
        if (loaded.length > 0) setMission(loaded[0]);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Missies ophalen is mislukt.");
        }
      } finally {
        if (!cancelled) setLoadingMissions(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const resetFeedback = useCallback(() => {
    setRoleOutput("");
    setDirectorReason("");
    setUsedKnowledge([]);
    setNeedsApproval(false);
    setApproveInfo("");
  }, []);

  const selectMission = useCallback(
    (candidate: MissionV2) => {
      setMission(candidate);
      resetFeedback();
      setError("");
    },
    [resetFeedback],
  );

  const createMission = useCallback(async () => {
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
      setMissions((current) => [created, ...current].slice(0, MISSION_LIST_LIMIT));
      setTitle("");
      setObjective("");
      setSuccessCriteriaText("");
      setRiskLevel("LOW");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Mission aanmaken is mislukt.");
    } finally {
      setBusy(null);
    }
  }, [objective, resetFeedback, riskLevel, successCriteriaText, title, user]);

  const autoStep = useCallback(async () => {
    if (!user || !mission) return;

    setBusy("auto-step");
    setError("");
    setNeedsApproval(false);
    setApproveInfo("");

    try {
      const result = await autoStepMissionV2(user, mission.missionId);

      setMission(result.mission);
      setMissions((current) =>
        current.map((entry) =>
          entry.missionId === result.mission.missionId ? result.mission : entry,
        ),
      );

      if (result.decision) setDirectorReason(result.decision.reason);
      if (result.roleOutput) setRoleOutput(result.roleOutput);
      setUsedKnowledge(result.usedKnowledge ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "De Director kon geen stap zetten.");

      // Toon de "Goedkeuring & Mergen"-knop precies wanneer dít de reden is
      // dat de stap niet doorging — op de gestructureerde code, niet op de
      // bewoording van de melding.
      const code = caught instanceof Error ? (caught as MissionEngineApiError).code : undefined;
      setNeedsApproval(code === NEEDS_SIGNOFF_CODE);
    } finally {
      setBusy(null);
    }
  }, [mission, user]);

  const approveAndMerge = useCallback(async () => {
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
  }, [mission, user]);

  const cancelMission = useCallback(async () => {
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
      setMissions((current) =>
        current.map((entry) => (entry.missionId === updated.missionId ? updated : entry)),
      );
      resetFeedback();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Mission annuleren is mislukt.");
    } finally {
      setBusy(null);
    }
  }, [mission, resetFeedback, user]);

  const value = useMemo<MissionEngineState>(
    () => ({
      missions,
      mission,
      loadingMissions,
      busy,
      error,
      roleOutput,
      directorReason,
      usedKnowledge,
      needsApproval,
      approveInfo,
      canAutoStep: Boolean(mission && AUTO_STEP_STATUSES.includes(mission.status)),
      canCancel: Boolean(mission && CANCELLABLE_STATUSES.includes(mission.status)),
      form: {
        title,
        objective,
        successCriteriaText,
        riskLevel,
        setTitle,
        setObjective,
        setSuccessCriteriaText,
        setRiskLevel,
      },
      selectMission,
      createMission,
      autoStep,
      approveAndMerge,
      cancelMission,
    }),
    [
      approveAndMerge,
      approveInfo,
      autoStep,
      busy,
      cancelMission,
      createMission,
      directorReason,
      error,
      loadingMissions,
      mission,
      missions,
      needsApproval,
      objective,
      riskLevel,
      roleOutput,
      selectMission,
      successCriteriaText,
      title,
      usedKnowledge,
    ],
  );

  return <MissionEngineContext.Provider value={value}>{children}</MissionEngineContext.Provider>;
}
