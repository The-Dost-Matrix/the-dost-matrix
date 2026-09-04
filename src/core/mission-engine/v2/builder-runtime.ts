import { randomUUID } from "node:crypto";

import type { RoleResult } from "@/core/contracts/v2";
import { getChatProvider } from "@/core/llm/model-router";
import { createUsageTracker, type UsageTracker } from "@/core/llm/usage-tracker";

import {
  createBranch,
  createPullRequest,
  getBranchHeadSha,
  getDefaultBranch,
  getFileContent,
  getGithubRepoTarget,
  getRepoTree,
  upsertFile,
} from "./github/github-client";
import type { MissionV2 } from "./mission";

/**
 * Builder Runtime v0 — de eerste versie van de Builder-rol die daadwerkelijk
 * bestanden aanpast, in plaats van alleen een plan te beschrijven (zoals de
 * oudere, tekst-only uitvoering in role-runtime.ts deed).
 *
 * Werkwijze, in lijn met de architectuurbeslissing dat agents nooit
 * rechtstreeks bestanden op de pc van de eigenaar aanraken: de Builder werkt
 * uitsluitend via de GitHub-repository. Hij leest de actuele bestandsboom en
 * de betrokken bestanden op via de GitHub API, laat een LLM de nieuwe inhoud
 * bepalen, en zet die klaar als een nieuwe branch met een pull request. Er
 * wordt nooit rechtstreeks naar de standaardbranch geschreven — de eigenaar
 * beoordeelt en merget de pull request zelf, er gebeurt niets automatisch.
 *
 * Bewust beperkt (v0), zelfde geest als de rest van Mission Engine V2:
 * - maximaal 8 bestanden per toewijzing;
 * - geen automatische QA-beoordeling van de wijziging (successCriteriaResults
 *   blijft leeg, net als bij de oude Role Runtime — dat is werk voor een
 *   toekomstige QA-rol);
 * - de Director ziet op dit moment de inhoud van dit resultaat (dus ook niet
 *   of de pull request al gemerged is) nog niet terug bij een volgende
 *   beslissing — hij ziet alleen dat de toewijzing is afgerond. Tot de
 *   QA-rol er is, blijft handmatig controleren van de pull request op
 *   GitHub dus nodig, ongeacht wat de missiestatus zegt.
 */

const MAX_FILES_PER_ASSIGNMENT = 8;
const MAX_TREE_LENGTH = 20_000;
// GEVONDEN ROOT CAUSE (live, via de CSS-missie): deze grens stond op 20.000
// tekens uit de tijd dat writeFiles() de inhoud van ALLE bestanden van een
// toewijzing (tot MAX_FILES_PER_ASSIGNMENT = 8 stuks) in één gedeelde prompt
// samenvoegde — toen moest elk bestand een klein deel van de totale ruimte
// delen. Sinds writeSingleFile() per bestand een eigen aanroep doet, geldt
// deze grens nog maar voor één bestand tegelijk, maar de waarde was nooit
// meegeschaald.
//
// Het gevolg: globals.css is 37.915 tekens groot. Met de oude grens van
// 20.000 werd bijna de helft (17.915 tekens) van het bestand stilzwijgend
// afgekapt VOORDAT de LLM de opdracht ("huidige inhoud van dit bestand")
// te zien kreeg. De LLM heeft dus nooit "onzorgvuldig" bestaande CSS laten
// vallen — hij heeft simpelweg nooit geweten dat die CSS bestond, en
// "reproduceerde" trouw precies wat hem wél werd voorgelegd. Dat verklaart
// exact welke stukken verdwenen (alles voorbij teken 20.000) toen QA een
// massale, ogenschijnlijk willekeurige verwijdering van bestaande CSS
// constateerde.
//
// Om dit structureel onmogelijk te maken (niet alleen minder waarschijnlijk)
// is dit niet zomaar een hoger getal: zie de expliciete controle in
// writeSingleFile() hieronder die de toewijzing hard laat stoppen zodra een
// bestand toch nog groter is dan deze grens, in plaats van het stilzwijgend
// af te kappen. Zo kán een LLM nooit meer een onvolledige weergave van een
// bestaand bestand als "de volledige huidige inhoud" gepresenteerd krijgen.
// 300.000 tekens (~75.000-100.000 tokens) past ruim binnen het contextvenster
// van claude-sonnet-5 en is ruim boven wat enig bestand in dit project nu
// haalt.
const MAX_FILE_CONTENT_LENGTH = 300_000;

type AssignmentRecord = MissionV2["assignments"][number];

/**
 * Herkent testbestanden aan hun bestandsnaam (`.test.ts`, `.spec.tsx`, etc.),
 * ongeacht taal/extensie-variant. Gebruikt om deze bestanden speciale
 * behandeling te geven in writeSingleFile() — zie de toelichting daar.
 */
export function isTestFilePath(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(path);
}

function buildBuilderSystemPrompt(mission: MissionV2): string {
  return [
    "Je bent de Builder-rol binnen The Dost Matrix, een persoonlijk AI-besturingssysteem.",
    `Je werkt aan de missie "${mission.title}" (doel: ${mission.objective}).`,
    "Je past de GitHub-repository van dit project aan door bestanden te lezen en te schrijven; je wijzigingen komen terecht in een pull request die de eigenaar zelf beoordeelt en merget.",
    // Bewust GEEN "antwoord in JSON"-instructie meer hier: dat stond hier
    // vroeger, terwijl geen van de aanroepen in dit bestand nog JSON
    // gebruikt (zie de toelichting bij planFiles/planMetadata/writeSingleFile
    // hieronder). Een systeeminstructie die iets anders zegt dan wat de
    // gebruikersprompt vraagt, is zelf een bron van onbetrouwbaarheid.
    "Volg exact het antwoordformaat dat in de instructie hieronder wordt gevraagd — niet automatisch JSON, tenzij dat expliciet gevraagd wordt.",
  ].join(" ");
}

/**
 * Haalt de waarde van "LABEL: waarde" op de regel waar dat label begint
 * (case-insensitief, ongeacht voorloopspaties). Gebruikt voor korte,
 * één-regelige velden.
 */
function extractLabeledLine(text: string, label: string): string | null {
  const match = text.match(new RegExp(`^[ \\t]*${label}\\s*:\\s*(.*)$`, "im"));
  return match ? match[1].trim() : null;
}

/**
 * Haalt alles op NA "LABEL:" tot het einde van de tekst — voor vrije,
 * eventueel meerregelige velden (zoals een PR-beschrijving) die als
 * laatste in het antwoordformaat staan.
 */
function extractLabeledBlock(text: string, label: string): string | null {
  const match = text.match(new RegExp(`${label}\\s*:`, "i"));
  if (!match || match.index === undefined) return null;
  return text.slice(match.index + match[0].length).trim();
}

function buildAssignmentDescription(mission: MissionV2, assignment: AssignmentRecord): string {
  const lines = [
    `Opdracht: ${assignment.objective}`,
    "",
    "Succescriteria voor deze toewijzing:",
    ...assignment.successCriteria.map((criterion) => `- ${criterion}`),
  ];

  if (mission.constraints.length > 0) {
    lines.push("", "Randvoorwaarden van de missie:");
    lines.push(...mission.constraints.map((constraint) => `- ${constraint}`));
  }

  return lines.join("\n");
}

interface BuilderPlan {
  paths: string[];
  planSummary: string;
}

/**
 * Vraagt welke bestanden de Builder wil aanmaken/aanpassen.
 *
 * GEEN JSON meer (zoals een eerdere versie deed): "planSummary" is vrije,
 * door de LLM geformuleerde tekst — en vrije tekst in een JSON-stringveld
 * loopt tegen precies dezelfde escaping-problemen aan (aanhalingstekens,
 * dubbele punten, regeleindes) die we al eerder bij de bestandsinhoud zelf
 * hebben opgelost door daar JSON te laten varen (zie writeSingleFile). Dit
 * bleek live ook echt mis te gaan: de zustergaanroep planMetadata() met
 * dezelfde JSON-aanpak gaf op een gegeven moment de fout "kon het antwoord
 * niet als JSON lezen" terug, puur omdat de vrije tekst niet JSON-veilig
 * was. In plaats van dat risico ook hier te laten bestaan, gebruikt dit een
 * simpel, labelgebaseerd tekstformaat zonder escaping-eisen.
 */
async function planFiles(
  mission: MissionV2,
  assignment: AssignmentRecord,
  treeText: string,
  usageTracker: UsageTracker,
): Promise<BuilderPlan> {
  const provider = getChatProvider();

  const userPrompt = [
    buildAssignmentDescription(mission, assignment),
    "",
    `Actuele bestandsboom van de repository (ingekort tot ${MAX_TREE_LENGTH} tekens indien nodig):`,
    treeText.slice(0, MAX_TREE_LENGTH),
    "",
    `Geef een lijst van maximaal ${MAX_FILES_PER_ASSIGNMENT} bestandspaden (relatief aan de root van de repository) die je moet aanmaken of aanpassen om deze opdracht te voltooien. Gebruik alleen paden die logisch passen bij de bestaande structuur hierboven.`,
    "",
    "BELANGRIJK: gebruik GEEN JSON. Antwoord EXACT in onderstaand tekstformaat, niets anders (geen markdown-codeblok eromheen, geen uitleg ervoor):",
    "",
    "BESTANDEN: pad/naar/bestand1, pad/naar/bestand2",
    "SAMENVATTING:",
    "(korte beschrijving van je aanpak, mag meerdere regels zijn — dit is de rest van je antwoord)",
  ].join("\n");

  const completion = await provider.chatCompletion(buildBuilderSystemPrompt(mission), [
    { role: "user", content: userPrompt },
  ]);
  usageTracker.add(completion);

  const bestandenLine = extractLabeledLine(completion.content, "BESTANDEN");
  const summaryBlock = extractLabeledBlock(completion.content, "SAMENVATTING");

  const paths = (bestandenLine ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^\/+/, ""))
    .filter((entry) => entry.length > 0)
    .slice(0, MAX_FILES_PER_ASSIGNMENT);

  if (paths.length === 0) {
    throw new Error("De Builder kon geen bestanden bepalen om aan te passen voor deze opdracht.");
  }

  return {
    paths,
    planSummary: summaryBlock && summaryBlock.length > 0 ? summaryBlock : "Geen samenvatting opgegeven.",
  };
}

interface PlannedFile {
  path: string;
  currentContent: string | null;
  currentSha?: string;
}

interface BuilderFileChange {
  path: string;
  content: string;
}

interface BuilderWriteResult {
  summary: string;
  pullRequestTitle: string;
  pullRequestBody: string;
  files: BuilderFileChange[];
  model: string;
}

interface BuilderMetadata {
  summary: string;
  pullRequestTitle: string;
  pullRequestBody: string;
}

/**
 * Vraagt de samenvattende informatie (summary, PR-titel, PR-body) op bij de
 * LLM — NA het schrijven van de bestanden, niet ervoor.
 *
 * GEVONDEN ROOT CAUSE (live, opnieuw via de CSS-missie): deze aanroep
 * gebeurde eerder VÓÓR writeSingleFile() — dus gebaseerd op alleen het plan
 * (bestandspaden + een korte aanpak-samenvatting), zonder dat de LLM de
 * daadwerkelijk te schrijven bestandsinhoud ooit te zien kreeg. Desondanks
 * werd er in de PR-beschrijving een gedetailleerd "voor/na"-codevoorbeeld
 * gegeven — dat kan op dat moment onmogelijk een feitelijke beschrijving
 * zijn geweest, want de echte inhoud bestond nog niet. QA (die wél de
 * echte diff via de GitHub API bekijkt) constateerde vervolgens dat de
 * daadwerkelijke wijziging er heel anders uitzag dan de PR-beschrijving
 * beweerde — precies het "LLM-verhaal versus werkelijke output"-probleem
 * dat we deze sessie al vaker zijn tegengekomen, nu ontstaan doordat de
 * beschrijving werd geschreven vóórdat er iets was om te beschrijven.
 *
 * Twee onafhankelijke maatregelen hiertegen: (1) deze aanroep gebeurt nu
 * pas NA writeFiles(), zodat de bestanden die worden genoemd ook echt al
 * geschreven zijn; (2) de instructie verbiedt nu expliciet het verzinnen
 * van voor/na-codevoorbeelden in de beschrijving — de echte diff staat toch
 * al op GitHub zelf, dus een tekstuele reconstructie daarvan is overbodig
 * en, zoals nu gebleken, een reëel risico.
 *
 * GEEN JSON: "pullRequestBody" is per definitie vrije tekst (mag
 * aanhalingstekens, dubbele punten, regeleindes bevatten) die niet
 * betrouwbaar in een JSON-stringveld past — dit gaf hier eerder ook al
 * live een storing. Labelgebaseerd tekstformaat zoals planFiles()
 * hierboven, met per veld een eigen fallback.
 */
async function planMetadata(
  mission: MissionV2,
  assignment: AssignmentRecord,
  plan: BuilderPlan,
  writtenFiles: BuilderFileChange[],
  usageTracker: UsageTracker,
): Promise<BuilderMetadata> {
  const provider = getChatProvider();

  const userPrompt = [
    buildAssignmentDescription(mission, assignment),
    "",
    `Jouw plan: ${plan.planSummary}`,
    `Bestanden die je zojuist daadwerkelijk hebt geschreven: ${writtenFiles.map((file) => file.path).join(", ")}`,
    "",
    "Geef samenvattende informatie over de wijziging die je zojuist hebt doorgevoerd.",
    "",
    'BELANGRIJK: beschrijf in gewone taal WAT er is veranderd en WAAROM — gebruik GEEN codevoorbeelden, geen "voor/na"-fragmenten en geen letterlijke regelnummers of code-snippets in je beschrijving. De echte, volledige wijziging is al zichtbaar in de diff van de pull request zelf; een tekstuele reconstructie daarvan voegt niets toe en kan afwijken van wat er echt staat.',
    "",
    "BELANGRIJK: gebruik GEEN JSON — vrije tekst zoals een PR-beschrijving kan aanhalingstekens, dubbele punten en regeleindes bevatten die JSON breken. Antwoord EXACT in onderstaand tekstformaat, niets anders (geen markdown-codeblok eromheen, geen uitleg ervoor):",
    "",
    "SAMENVATTING: (korte beschrijving van wat je hebt gebouwd, één regel)",
    "PR_TITEL: (korte titel voor de pull request, één regel)",
    "PR_BESCHRIJVING:",
    "(beschrijving in gewone taal, geen code — mag meerdere regels bevatten — dit is de rest van je antwoord)",
  ].join("\n");

  const completion = await provider.chatCompletion(buildBuilderSystemPrompt(mission), [
    { role: "user", content: userPrompt },
  ]);
  usageTracker.add(completion);

  const summary = extractLabeledLine(completion.content, "SAMENVATTING");
  const pullRequestTitle = extractLabeledLine(completion.content, "PR_TITEL");
  const pullRequestBody = extractLabeledBlock(completion.content, "PR_BESCHRIJVING");

  return {
    summary: summary && summary.length > 0 ? summary : plan.planSummary,
    pullRequestTitle:
      pullRequestTitle && pullRequestTitle.length > 0
        ? pullRequestTitle
        : `Director: ${mission.title}`,
    pullRequestBody:
      pullRequestBody && pullRequestBody.length > 0 ? pullRequestBody : assignment.objective,
  };
}

interface SingleFileWriteResult {
  content: string;
  model: string;
}

/**
 * Bouwt het extra promptgedeelte voor testbestanden.
 *
 * GEVONDEN ROOT CAUSE (live, via vier opeenvolgende missies — PR #24, #25,
 * #26 en #27): elk bestand werd via writeSingleFile() in een volledig
 * geïsoleerde LLM-aanroep geschreven, die bij een NIEUW bestand alleen
 * "Dit bestand bestaat nog niet — maak het volledig nieuw aan" te zien
 * kreeg. Bij een nieuw testbestand betekende dit dat de LLM de broncode van
 * de module die hij moest testen NOOIT te zien kreeg — hij kende alleen het
 * bestandspad en de missietekst. Het gevolg: verzonnen functienamen
 * (`createOrUpdateFile` in plaats van de echte `upsertFile`), verzonnen
 * argumentvolgordes, en — omdat er ook geen bestaand testbestand als
 * stijlvoorbeeld werd meegegeven — een terugval op Jest-syntax terwijl dit
 * project vitest gebruikt. Dit gebeurde bij VIER van de vier missies met
 * tests, ondanks dat de mission brief telkens expliciet "gebruik vitest"
 * vermeldde: geen hoeveelheid tekstuele instructie lost dit op zolang de
 * daadwerkelijke broncode nooit wordt getoond.
 *
 * De fix: bij een testbestand krijgt de LLM (1) de volledige, daadwerkelijke
 * inhoud van de andere bestanden uit dezelfde toewijzing (dus de module die
 * hij hoogstwaarschijnlijk test, met de ECHTE functienamen en signaturen),
 * (2) een bestaand testbestand uit dit project als stijl-/frameworkvoorbeeld
 * indien er een gevonden kan worden, en (3) een expliciete instructie om
 * nooit een functienaam, parameter of importpad te verzinnen. Zie
 * executeBuilderAssignment() voor hoe siblingFiles/exampleTestFile worden
 * bepaald en waarom niet-testbestanden altijd vóór testbestanden worden
 * geschreven binnen dezelfde toewijzing (zodat siblingFiles altijd de
 * daadwerkelijk NIEUWE inhoud bevat, niet de oude).
 */
export function buildTestContextBlock(
  siblingFiles: BuilderFileChange[],
  exampleTestFile: { path: string; content: string } | null,
  usesVitest: boolean,
): string {
  const sections: string[] = [
    "BELANGRIJK — dit is een testbestand. Verzin NOOIT een functienaam, parameter, importpad of returnwaarde: gebruik uitsluitend wat je hieronder daadwerkelijk in de broncode ziet staan. Komt een functie niet voor in de broncode hieronder, dan bestaat hij niet en mag je hem niet gebruiken.",
  ];

  if (usesVitest) {
    sections.push(
      "Dit project gebruikt vitest, niet Jest: importeer describe/it/expect/vi (en indien nodig beforeEach/afterEach/beforeAll/afterAll) altijd expliciet uit 'vitest'. Gebruik nooit jest.*, en gebruik describe/it nooit als impliciete globals zonder import.",
    );
  }

  if (siblingFiles.length > 0) {
    sections.push(
      "",
      "Volledige, daadwerkelijke inhoud van de andere bestanden uit deze toewijzing (dit is vermoedelijk (een deel van) de code die je moet testen — neem functienamen, parameters en returnwaarden hier letterlijk uit over, verzin niets):",
    );
    for (const sibling of siblingFiles) {
      sections.push(`--- ${sibling.path} ---`, sibling.content, `--- einde ${sibling.path} ---`);
    }
  }

  if (exampleTestFile) {
    sections.push(
      "",
      `Ter referentie, een bestaand testbestand uit dit project (${exampleTestFile.path}) — volg hetzelfde testframework en dezelfde stijl (mocking-aanpak, importstructuur):`,
      `--- ${exampleTestFile.path} ---`,
      exampleTestFile.content,
      `--- einde ${exampleTestFile.path} ---`,
    );
  }

  return sections.join("\n");
}

/**
 * Verwijdert een eventueel markdown-codeblok (```taal ... ```) rondom de
 * volledige inhoud van het antwoord — voor het geval het model, ondanks de
 * instructie om dat niet te doen, de bestandsinhoud toch in een codeblok
 * verpakt. Alleen een codeblok dat het HELE antwoord omvat wordt eraf
 * gehaald; bij twijfel (bijvoorbeeld meerdere codeblokken) wordt de tekst
 * onaangeroerd gelaten, om nooit per ongeluk echte bestandsinhoud te
 * verminken.
 */
function stripSurroundingCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/);
  return match ? match[1] : trimmed;
}

/**
 * Vraagt de VOLLEDIGE inhoud van precies één bestand op bij de LLM.
 *
 * Waarom per bestand een eigen aanroep, in plaats van één aanroep voor de
 * hele toewijzing (zoals de vorige versie deed): bij meerdere bestanden in
 * één toewijzing (bijvoorbeeld een component + een CSS-bestand) moest de
 * LLM voorheen de volledige inhoud van ALLE bestanden samen binnen één
 * tokenplafond (MAX_OUTPUT_TOKENS) teruggeven. Door dit werk op te splitsen
 * in één aanroep per bestand, blijft het benodigde tokenbudget per aanroep
 * gelijk ongeacht hoeveel bestanden de toewijzing bevat.
 *
 * Waarom GEEN ===FILE===/===ENDFILE===-markeringen meer (zoals een eerdere
 * versie deed): die markeringen waren alleen nodig om meerdere bestanden in
 * één antwoord van elkaar te scheiden. Nu elke aanroep hier al maar één
 * bestand betreft, is dat niet meer nodig — en die markeringen bleken juist
 * zelf een bron van fouten: bij een lang bestand (bijvoorbeeld een CSS-
 * bestand van 20K+ tekens) bleek het model soms de hele inhoud correct te
 * schrijven maar de afsluitende ===ENDFILE===-regel simpelweg te vergeten
 * (bevestigd via logging: stop_reason "end_turn", dus het model was gewoon
 * klaar — dit was GEEN tokenlimiet-probleem). Door in plaats daarvan het
 * volledige antwoord zelf als bestandsinhoud te behandelen, is er geen
 * afsluitmarkering meer die vergeten kán worden.
 */
async function writeSingleFile(
  mission: MissionV2,
  assignment: AssignmentRecord,
  plan: BuilderPlan,
  file: PlannedFile,
  usageTracker: UsageTracker,
  siblingFiles: BuilderFileChange[],
  exampleTestFile: { path: string; content: string } | null,
  usesVitest: boolean,
): Promise<SingleFileWriteResult> {
  const provider = getChatProvider();

  // Hard stoppen in plaats van stilzwijgend afkappen wanneer een bestaand
  // bestand groter is dan MAX_FILE_CONTENT_LENGTH. Dit is de kern van de fix
  // voor een live geconstateerde regressie: door eerder gewoon te knippen
  // (.slice(0, MAX_FILE_CONTENT_LENGTH)) kreeg de LLM een ONVOLLEDIGE
  // weergave van globals.css te zien alsof het de volledige, huidige inhoud
  // was — met als gevolg dat de "volledige nieuwe inhoud" die de LLM
  // teruggaf braaf overeenkwam met wat hem getoond werd, maar het gedeelte
  // voorbij de afkapgrens (bijna de helft van het bestand) gewoon miste.
  // QA ving dat gelukkig af, maar de juiste, structurele fix is dat dit
  // scenario helemaal niet meer kán ontstaan: als een bestand ooit groter
  // wordt dan wat we betrouwbaar in één keer kunnen meegeven, moet de
  // toewijzing expliciet falen (en dus actief/herprobeerbaar blijven, net
  // als andere Builder-fouten) in plaats van de LLM een vervalste "volledige
  // inhoud" voor te schotelen.
  if (file.currentContent !== null && file.currentContent.length > MAX_FILE_CONTENT_LENGTH) {
    throw new Error(
      `Bestand "${file.path}" is te groot om veilig in één keer te laten herschrijven (${file.currentContent.length} tekens, limiet ${MAX_FILE_CONTENT_LENGTH}). Om te voorkomen dat de Builder een onvolledige kopie van dit bestand als "volledige inhoud" gepresenteerd krijgt en daardoor per ongeluk bestaande inhoud laat verdwijnen — precies wat er eerder gebeurde met globals.css — wordt hier bewust gestopt in plaats van het bestand stilzwijgend af te kappen.`,
    );
  }

  const status =
    file.currentContent === null ? "NIEUW BESTAND (bestaat nog niet)" : "BESTAAND BESTAND";
  const currentContentBlock =
    file.currentContent === null
      ? "Dit bestand bestaat nog niet — maak het volledig nieuw aan."
      : `Huidige inhoud van dit bestand:\n---\n${file.currentContent}\n---`;

  const otherPaths = plan.paths.filter((path) => path !== file.path);
  const testContextBlock = isTestFilePath(file.path)
    ? buildTestContextBlock(siblingFiles, exampleTestFile, usesVitest)
    : "";

  const userPrompt = [
    buildAssignmentDescription(mission, assignment),
    "",
    `Jouw plan: ${plan.planSummary}`,
    otherPaths.length > 0
      ? `Andere bestanden die in dezelfde toewijzing worden aangepast (schrijf die hier NIET — dat gebeurt in aparte stappen): ${otherPaths.join(", ")}`
      : "",
    "",
    `Je schrijft nu UITSLUITEND het bestand "${file.path}" (${status}).`,
    currentContentBlock,
    testContextBlock,
    "",
    "Geef de VOLLEDIGE nieuwe inhoud van dit ene bestand terug (niet alleen het verschil). Schrijf productiekwaliteit code die aansluit bij de bestaande stijl.",
    "",
    "BELANGRIJK: je antwoord IS de nieuwe bestandsinhoud, van de allereerste tot de allerlaatste regel — niets ervoor, niets erna. Geen markdown-codeblok (geen ``` eromheen), geen uitleg, geen inleidende zin zoals \"Hier is de inhoud:\", geen ===FILE===- of andere markeringen. Begin direct met de eerste regel van het bestand en stop na de laatste regel.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const completion = await provider.chatCompletion(buildBuilderSystemPrompt(mission), [
    { role: "user", content: userPrompt },
  ]);
  usageTracker.add(completion);

  const content = stripSurroundingCodeFence(completion.content);

  if (!content) {
    // Log het echte antwoord naar de terminal van "npm run dev" — zo
    // hoeven we bij een onverwachte lege inhoud niet te gissen naar de
    // oorzaak, maar kunnen we het letterlijk zien.
    console.error(
      [
        `Builder-antwoord voor "${file.path}" was leeg na verwerking.`,
        `stop_reason: ${completion.stopReason ?? "onbekend"}`,
        `Ruwe lengte van het antwoord: ${completion.content.length} tekens.`,
      ].join("\n"),
    );

    const reasonHint =
      completion.stopReason === "max_tokens"
        ? `het antwoord werd afgekapt door het tokenplafond (ontving ${completion.content.length} tekens voordat het stopte)`
        : `het model gaf zelf een leeg antwoord terug (stop_reason: ${completion.stopReason ?? "onbekend"})`;

    throw new Error(
      `De Builder gaf geen bestandsinhoud terug voor "${file.path}": ${reasonHint}. Bekijk de terminal van "npm run dev" voor meer details.`,
    );
  }

  return { content, model: completion.model };
}

async function writeFiles(
  mission: MissionV2,
  assignment: AssignmentRecord,
  plan: BuilderPlan,
  plannedFiles: PlannedFile[],
  usageTracker: UsageTracker,
  exampleTestFile: { path: string; content: string } | null,
  usesVitest: boolean,
): Promise<BuilderWriteResult> {
  const files: BuilderFileChange[] = [];
  let model = "";

  // plannedFiles staat altijd met niet-testbestanden eerst (zie
  // executeBuilderAssignment) — daardoor bevat `files` op het moment dat een
  // testbestand aan de beurt is altijd al de daadwerkelijk NIEUW geschreven
  // inhoud van zijn siblings in deze toewijzing, niet de oude repo-inhoud.
  for (const file of plannedFiles) {
    const siblingFiles = files.filter((written) => written.path !== file.path);
    const written = await writeSingleFile(
      mission,
      assignment,
      plan,
      file,
      usageTracker,
      siblingFiles,
      exampleTestFile,
      usesVitest,
    );
    files.push({ path: file.path, content: written.content });
    model = written.model;
  }

  if (files.length === 0) {
    throw new Error("De Builder gaf geen bestandsinhoud terug om weg te schrijven.");
  }

  // Bewust pas HIER, na het schrijven van alle bestanden — zie de
  // toelichting bij planMetadata() voor waarom deze volgorde cruciaal is.
  const metadata = await planMetadata(mission, assignment, plan, files, usageTracker);

  return {
    summary: metadata.summary,
    pullRequestTitle: metadata.pullRequestTitle,
    pullRequestBody: metadata.pullRequestBody,
    files,
    model,
  };
}

export interface ExecuteBuilderAssignmentInput {
  mission: MissionV2;
  assignment: AssignmentRecord;
}

export interface ExecuteBuilderAssignmentOutput {
  result: RoleResult;
  roleOutput: string;
}

/**
 * Voert een toewijzing van de Builder-rol daadwerkelijk uit: leest de
 * repository via GitHub, laat een LLM de wijzigingen bepalen, en zet die
 * klaar als pull request.
 *
 * Gooit een duidelijke fout wanneer GitHub niet bereikbaar is, de sleutel
 * ontbreekt, of de LLM geen bruikbaar antwoord geeft — de toewijzing blijft
 * dan actief staan (er wordt geen resultaat vastgelegd) zodat de eigenaar
 * het na het oplossen opnieuw kan proberen.
 */
export async function executeBuilderAssignment({
  mission,
  assignment,
}: ExecuteBuilderAssignmentInput): Promise<ExecuteBuilderAssignmentOutput> {
  const startedAt = Date.now();
  const target = getGithubRepoTarget();

  // Eén tracker voor de hele toewijzing: die doet meerdere losse LLM-
  // aanroepen (plannen, per bestand schrijven, samenvatten) en zonder dit
  // zou alleen de kosten van de LAATSTE aanroep zichtbaar worden in plaats
  // van de werkelijke totaalkosten (zie usage-tracker.ts).
  const usageTracker = createUsageTracker();

  const defaultBranch = await getDefaultBranch(target);
  const baseSha = await getBranchHeadSha(target, defaultBranch);
  const tree = await getRepoTree(target, defaultBranch);

  const treeText = tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path)
    .sort()
    .join("\n");

  const plan = await planFiles(mission, assignment, treeText, usageTracker);

  // Niet-testbestanden altijd EERST schrijven binnen een toewijzing, ongeacht
  // in welke volgorde de LLM ze in zijn plan noemde — zie de toelichting bij
  // buildTestContextBlock() hierboven voor waarom: hierdoor bevat de context
  // die een testbestand te zien krijgt altijd de al daadwerkelijk geschreven
  // (nieuwe) inhoud van de bestanden die het waarschijnlijk test.
  plan.paths = [
    ...plan.paths.filter((path) => !isTestFilePath(path)),
    ...plan.paths.filter((path) => isTestFilePath(path)),
  ];

  // Aanwezigheid van een vitest-configbestand in de repository-boom bepaalt
  // of de expliciete "gebruik vitest, geen Jest"-instructie wordt toegevoegd
  // aan testbestanden — dit blijft correct werken als het project ooit van
  // testrunner zou wisselen, zonder dat deze code hoeft te weten welke
  // runner dat precies is.
  const usesVitest = tree.some(
    (entry) => entry.type === "blob" && /^vitest\.config\.(ts|mts|js|mjs)$/.test(entry.path),
  );

  // Eén bestaand testbestand uit de repository ophalen als stijl-/
  // frameworkvoorbeeld — maar alleen wanneer deze toewijzing daadwerkelijk
  // een testbestand bevat, om onnodige GitHub-aanroepen te vermijden.
  let exampleTestFile: { path: string; content: string } | null = null;
  if (plan.paths.some((path) => isTestFilePath(path))) {
    const exampleTestPath = tree
      .filter(
        (entry) =>
          entry.type === "blob" && isTestFilePath(entry.path) && !plan.paths.includes(entry.path),
      )
      .map((entry) => entry.path)
      .sort()[0];

    if (exampleTestPath) {
      const example = await getFileContent(target, exampleTestPath, defaultBranch);
      if (example) {
        exampleTestFile = { path: exampleTestPath, content: example.content };
      }
    }
  }

  const plannedFiles: PlannedFile[] = [];
  for (const path of plan.paths) {
    const existing = await getFileContent(target, path, defaultBranch);
    plannedFiles.push({
      path,
      currentContent: existing?.content ?? null,
      currentSha: existing?.sha,
    });
  }

  const writeResult = await writeFiles(
    mission,
    assignment,
    plan,
    plannedFiles,
    usageTracker,
    exampleTestFile,
    usesVitest,
  );

  // Alleen bestanden schrijven die ook echt gepland waren — voorkomt dat de
  // tweede LLM-aanroep alsnog een bestand buiten de lijst van planFiles()
  // verzint en per ongeluk iets onbedoelds overschrijft of een sha-conflict
  // veroorzaakt.
  const plannedPaths = new Set(plan.paths);
  const filesToWrite = writeResult.files
    .filter((file) => plannedPaths.has(file.path))
    .slice(0, MAX_FILES_PER_ASSIGNMENT);

  if (filesToWrite.length === 0) {
    throw new Error(
      "De Builder gaf geen bruikbare bestandsinhoud terug binnen het geplande bestandenoverzicht.",
    );
  }

  const branchName = `director/mission-${mission.missionId.slice(0, 8)}-${Date.now()}`;
  await createBranch(target, branchName, baseSha);

  const shaByPath = new Map(plannedFiles.map((file) => [file.path, file.currentSha]));

  for (const file of filesToWrite) {
    await upsertFile(target, {
      path: file.path,
      content: file.content,
      message: `Director: ${assignment.objective}`.slice(0, 200),
      branch: branchName,
      sha: shaByPath.get(file.path),
    });
  }

  // Deterministische, door code bepaalde lijst van daadwerkelijk geschreven
  // bestanden — NIET de vrije tekst van de LLM (writeResult.pullRequestBody).
  // De LLM's eigen samenvatting kan meer beweren dan hij daadwerkelijk heeft
  // geschreven (bijvoorbeeld claimen dat een CSS-bestand is aangepast terwijl
  // er alleen een ===FILE===-blok voor het component kwam) — dat gebeurde
  // hier ook echt. Door deze regel altijd zelf toe te voegen aan de
  // pull-requestbeschrijving, hoeft de eigenaar niet te vertrouwen op wat de
  // Builder zégt te hebben gedaan, en is dit ook zichtbaar op GitHub zelf
  // (niet alleen in de app, waar dezelfde lijst al in roleOutput stond).
  const filesLine = `Bestanden in deze pull request (bepaald door de code, niet door de LLM): ${filesToWrite
    .map((file) => file.path)
    .join(", ")}`;

  const pullRequest = await createPullRequest(target, {
    title: writeResult.pullRequestTitle,
    head: branchName,
    base: defaultBranch,
    body: [
      writeResult.pullRequestBody,
      "",
      filesLine,
      "",
      `Missie: ${mission.title}`,
      `Toewijzing: ${assignment.objective}`,
      "",
      "Deze pull request is automatisch aangemaakt door de Builder-rol van Mission Engine V2. Beoordeel de wijzigingen en merge alleen wanneer je tevreden bent — er gebeurt niets automatisch.",
    ].join("\n"),
  });

  const durationMs = Date.now() - startedAt;
  const now = new Date().toISOString();

  const roleOutput = [
    writeResult.summary,
    "",
    `Bestanden aangepast: ${filesToWrite.map((file) => file.path).join(", ")}`,
    `Pull request geopend: ${pullRequest.url}`,
    "Deze wijziging is nog niet gemerged — beoordeel de pull request op GitHub en merge hem zelf wanneer je tevreden bent.",
  ].join("\n");

  const result: RoleResult = {
    resultId: randomUUID(),
    assignmentId: assignment.assignmentId,
    missionId: mission.missionId,
    status: "COMPLETED",
    summary: roleOutput.slice(0, 500),
    deliverables: [pullRequest.url],
    evidence: [],
    assumptions: [],
    uncertainties: [],
    risks: [],
    recommendations: ["Beoordeel de pull request op GitHub voordat je hem merget."],
    successCriteriaResults: {},
    artifactRefs: [pullRequest.url],
    usage: {
      provider: getChatProvider().id,
      model: writeResult.model,
      durationMs,
      inputTokens: usageTracker.totals().inputTokens,
      outputTokens: usageTracker.totals().outputTokens,
      cost: usageTracker.totals().cost,
      currency: "USD",
    },
    createdAt: now,
  };

  return { result, roleOutput };
}
