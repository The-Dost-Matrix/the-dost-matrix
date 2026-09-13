/**
 * Echte systeemstatus voor het Command Center.
 *
 * Aanleiding: de statuspanelen in de zijbalk en de System Monitor toonden tot
 * nu toe hardgecodeerde teksten ("All systems operational", "Firebase ONLINE",
 * "OpenAI READY"). Er werd niets gecontroleerd. Dat is dezelfde categorie fout
 * als een samenvatting van een LLM geloven zonder de echte output te zien: het
 * scherm zei iets over de werkelijkheid zonder die werkelijkheid te raadplegen.
 *
 * Twee regels die hier bewust worden vastgelegd:
 *
 * 1. Elke component vermeldt HOE de status is vastgesteld (`checkedVia`).
 *    "configuratie" betekent: we hebben alleen gekeken of de benodigde
 *    instellingen aanwezig zijn. "live" betekent: er is daadwerkelijk een
 *    aanroep gedaan die geslaagd of mislukt is. Zo kan het scherm nooit meer
 *    suggereren dat iets bewezen werkt terwijl alleen een sleutel is gezet.
 * 2. Ontbrekende configuratie is een eigen niveau (NOT_CONFIGURED), geen
 *    fout en geen "OK". Dat is een normale toestand tijdens het bouwen.
 */

export type SystemStatusLevel = "OK" | "DEGRADED" | "NOT_CONFIGURED" | "ERROR";

export type SystemStatusCheckedVia = "configuratie" | "live";

export interface SystemComponentStatus {
  id: "llm" | "github" | "firestore";
  label: string;
  level: SystemStatusLevel;
  /** Korte, feitelijke toelichting — bijvoorbeeld het actieve model. */
  detail: string;
  checkedVia: SystemStatusCheckedVia;
}

export interface SystemStatusReport {
  checkedAt: string;
  components: SystemComponentStatus[];
}

export interface ActiveChatModel {
  provider: string;
  model: string;
  /**
   * Stap 24: "instelling" wanneer deze keuze uit de opgeslagen
   * providerinstelling komt, "omgeving" wanneer hij uit de
   * omgevingsvariabelen valt. Optioneel gehouden zodat een aanroeper die dit
   * niet meegeeft blijft werken.
   */
  source?: "instelling" | "omgeving";
}

/**
 * Welke LLM daadwerkelijk gebruikt zou worden. Bewust doorgegeven in plaats
 * van hier opnieuw uitgerekend, zodat dit niet uit de pas kan lopen met de
 * echte keuze in model-router.ts.
 */
export function buildLlmStatus(activeModel: ActiveChatModel | null): SystemComponentStatus {
  if (!activeModel) {
    return {
      id: "llm",
      label: "LLM-provider",
      level: "NOT_CONFIGURED",
      detail: "Geen ANTHROPIC_API_KEY of OPENAI_API_KEY gezet.",
      checkedVia: "configuratie",
    };
  }

  // De herkomst staat erbij sinds stap 24. Zonder dat is niet te zien of een
  // opgeslagen keuze werkelijk aankomt: draait de code buiten een
  // withOwnerLlmSettings-wrapper, dan gebruikt hij stilletjes de omgeving.
  return {
    id: "llm",
    label: "LLM-provider",
    level: "OK",
    detail: activeModel.source
      ? `${activeModel.provider}/${activeModel.model} (via ${activeModel.source})`
      : `${activeModel.provider}/${activeModel.model}`,
    checkedVia: "configuratie",
  };
}

export function buildFirestoreStatus(env: NodeJS.ProcessEnv): SystemComponentStatus {
  const hasCredentials =
    Boolean(env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim()) ||
    Boolean(env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim());

  return hasCredentials
    ? {
        id: "firestore",
        label: "Firestore",
        level: "OK",
        detail: "Service-account gevonden.",
        checkedVia: "configuratie",
      }
    : {
        id: "firestore",
        label: "Firestore",
        level: "NOT_CONFIGURED",
        detail: "FIREBASE_SERVICE_ACCOUNT_KEY of _FILE ontbreekt.",
        checkedVia: "configuratie",
      };
}

const GITHUB_APP_ENV_VARS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_APP_PRIVATE_KEY",
] as const;

export function findMissingGithubAppEnvVars(env: NodeJS.ProcessEnv): string[] {
  return GITHUB_APP_ENV_VARS.filter((name) => !env[name]?.trim());
}

/**
 * De GitHub-status wordt als enige met een ECHTE aanroep vastgesteld: het
 * ophalen van de standaardbranch bewijst dat de App-authenticatie werkt en
 * dat de installatie toegang heeft tot de repository. Alleen controleren of
 * de omgevingsvariabelen bestaan zou precies het soort schijnzekerheid geven
 * dat we hier juist weghalen.
 *
 * De controle wordt geïnjecteerd zodat dit testbaar blijft zonder netwerk.
 */
export async function buildGithubStatus(
  env: NodeJS.ProcessEnv,
  checkConnection: () => Promise<string>,
): Promise<SystemComponentStatus> {
  const missing = findMissingGithubAppEnvVars(env);

  if (missing.length > 0) {
    return {
      id: "github",
      label: "GitHub App",
      level: "NOT_CONFIGURED",
      detail: `Ontbrekende instellingen: ${missing.join(", ")}.`,
      checkedVia: "configuratie",
    };
  }

  try {
    const detail = await checkConnection();
    return {
      id: "github",
      label: "GitHub App",
      level: "OK",
      detail,
      checkedVia: "live",
    };
  } catch (error) {
    return {
      id: "github",
      label: "GitHub App",
      level: "ERROR",
      detail: error instanceof Error ? error.message : String(error),
      checkedVia: "live",
    };
  }
}

/** Het slechtste niveau bepaalt de samenvatting; NOT_CONFIGURED is geen fout. */
export function summarizeStatusLevel(components: SystemComponentStatus[]): SystemStatusLevel {
  if (components.some((component) => component.level === "ERROR")) return "ERROR";
  if (components.some((component) => component.level === "DEGRADED")) return "DEGRADED";
  if (components.some((component) => component.level === "NOT_CONFIGURED")) return "NOT_CONFIGURED";
  return "OK";
}
