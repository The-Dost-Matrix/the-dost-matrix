import { getChatProvider } from "@/core/llm/model-router";

import type { PullRequestFileChange } from "./github/github-client";
import type { MissionV2 } from "./mission";

/**
 * Stap 15 — Autonome missie-triggers met geautomatiseerde signoff.
 *
 * Vóór deze stap betekende een "needs-signoff"-risicoclassificatie
 * (risk-classification.ts) altijd hetzelfde: de Director gooit NEEDS_SIGNOFF
 * en de missie blijft liggen totdat Elroy de pull request zelf op GitHub of
 * via de "Goedkeuring & Mergen"-knop beoordeelt. Elroy heeft expliciet
 * gevraagd die beoordeling aan de Director/Claude over te dragen, zodat een
 * missie ook 's nachts kan doorlopen zonder op zijn eigen klik te wachten.
 *
 * Dit bestand is die overgedragen beoordeling — niet meer en niet minder.
 * Het vervangt de MENSELIJKE blik vóór een needs-signoff-merge door een
 * TWEEDE, onafhankelijke modelbeoordeling die de daadwerkelijke diff leest
 * (niet alleen bestandsnamen) en escaleert zodra ze een benoembaar risico ziet
 * — zie de bijstelling onderaan deze toelichting voor waar die lat precies
 * ligt en waarom.
 * Het vervangt geen van de bestaande vangnetten: CI moet nog steeds groen
 * zijn en alle succescriteria moeten nog steeds PASSED zijn vóórdat
 * ensureMissionPullRequestMerged (director-runtime.ts) dit hier zelfs
 * aanroept, en een aparte, hardere categorie wijzigingen (zie
 * findHardEscalationReason in risk-classification.ts) komt hier nooit
 * binnen — die escaleert altijd naar Elroy, ongeacht wat deze beoordeling
 * zou zeggen.
 *
 * Een ontbrekend, dubbelzinnig of onleesbaar oordeel telt NOOIT als
 * goedkeuring — dezelfde discipline als QA's UNDETERMINED (stap 12b) en de
 * Raad's ONDUIDELIJK (stap 13). Deze functie kan de bestaande veiligheid dus
 * alleen versoepelen richting "automatisch mergen na een tweede, oprechte
 * beoordeling", nooit richting "mergen zonder enige beoordeling".
 *
 * BIJSTELLING VAN 18 SEPTEMBER 2026 — WAAROM DE LAT ANDERS LIGT
 *
 * De eerste versie van de instructie hieronder eindigde met: "Twijfel je, ook
 * maar een beetje? Kies dan escaleren." Dat klinkt verstandig en was het niet.
 * In de twee keer dat deze beoordeling live heeft gedraaid, heeft ze nog nooit
 * iets goedgekeurd:
 *
 * - PR #58 (13 september) — escaleerde omdat ze twee onbesproken keuzes zag in
 *   hoe een functie eurobedragen afrondt. Niets kapot, niets onomkeerbaar.
 * - PR #64 (18 september) — escaleerde op een afgekapte diff. Dat was onze
 *   eigen fout in de budgetverdeling, inmiddels gerepareerd.
 *
 * Elroy heeft beide keren zelf moeten beoordelen en mergen — precies het werk
 * dat hij met stap 15 expliciet had overgedragen. Een beoordeling die altijd
 * escaleert is geen beoordeling maar een doorgeefluik, en dan bestaat deze
 * hele stap voor niets.
 *
 * De lat ligt daarom nu op een BENOEMBAAR risico: wat gaat er kapot, of wat is
 * moeilijk terug te draaien. Een opmerking maken mag, escaleren op een
 * opmerking niet. Wat er niet verandert: de harde escalatiecategorie
 * (findHardEscalationReason), groene CI, alle succescriteria PASSED, en een
 * onleesbaar oordeel dat nooit als goedkeuring telt. Dit verschuift de
 * afweging binnen die vangnetten, niet de vangnetten zelf.
 */

export interface AutomatedSignoffResult {
  approved: boolean;
  reason: string;
}

const VERDICT_TAG_PATTERN = /<oordeel>\s*(AKKOORD|ESCALEREN)\s*<\/oordeel>/gi;

// Zelfde reden als MAX_KNOWLEDGE_CONTEXT_LENGTH in director-runtime.ts: een
// harde grens op wat naar het model gaat, zodat één ongebruikelijk grote
// diff nooit een onbeperkt dure of onbeperkt lange aanroep veroorzaakt.
const MAX_TOTAL_DIFF_CHARS = 16_000;

/**
 * Ondergrens per bestand. Onder ongeveer dit aantal tekens is een stuk diff
 * niet meer te beoordelen maar alleen nog te bekijken, en dan is het eerlijker
 * om te melden dat er bestanden zijn weggelaten dan om er twintig snippers
 * naast elkaar te leggen.
 */
const MIN_PATCH_CHARS_PER_FILE = 1_500;

export const SYSTEM_PROMPT = `Je bent de laatste, geautomatiseerde controle voordat een pull request
automatisch wordt gemerged in de eigen codebase van The Dost Matrix, ZONDER
dat de eigenaar (Elroy) hem zelf heeft bekeken. Elroy heeft deze beoordeling
bewust aan jou overgedragen omdat hij geen programmeerachtergrond heeft. Hij
wil deze wijzigingen niet stuk voor stuk zelf hoeven beoordelen — dat is de
hele reden dat jij bestaat.

Context: alle succescriteria van de missie staan al op GEHAALD (QA heeft ze
goedgekeurd) en de CI-checks zijn al groen. Wijzigingen in een harde
categorie — sleutels en tokens, GitHub-workflows, authenticatie,
Firebase-configuratie, en elke bestandsverwijdering — komen hier sowieso nooit
binnen; die gaan altijd rechtstreeks naar Elroy. Alles wat jij te zien krijgt
is dus al door drie zeven gegaan.

Jouw vraag is deze: kun je concreet BENOEMEN hoe deze wijziging iets kapot
maakt, of waarom ze moeilijk terug te draaien zou zijn?

Kun je dat — noem het, en kies ESCALEREN. Bijvoorbeeld:
- de wijziging doet aantoonbaar meer dan de missie vroeg, en dat extra raakt
  gedrag elders;
- er staat een halve gedachte in: een tak die nergens heen gaat, een aanname
  die de rest van de code tegenspreekt;
- ze verandert opgeslagen gegevens, een publieke aanroepvorm of iets anders
  dat je niet met één revert terugdraait;
- de diff die je kreeg is afgekapt of onleesbaar, zodat je niet kúnt
  beoordelen wat er verandert.

Kun je dat NIET, dan kies je AKKOORD. Een algemeen ongemak is geen reden om te
escaleren, en de volgende dingen zijn dat uitdrukkelijk ook niet:
- smaak, stijl, naamgeving of indeling;
- een keuze die je anders had gemaakt maar die verdedigbaar is;
- iets dat beter gedocumenteerd of getest had kunnen worden zonder dat de
  missie daarom vroeg;
- randgevallen die de wijziging niet slechter afhandelt dan de code die er al
  stond.

Merk je zulke dingen wel op, schrijf ze dan gerust op in je toelichting — die
komt bij de missie te staan. Maar laat ze je oordeel niet bepalen.

Escaleer je, maak dan in je toelichting expliciet wat er kapot kan gaan. Een
escalatie zonder benoembaar risico kost Elroy tijd zonder hem iets te
vertellen.

Sluit je antwoord ALTIJD af met exact één van deze twee regels, verder niets
erna:
<oordeel>AKKOORD</oordeel>
<oordeel>ESCALEREN</oordeel>`;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… (afgekapt, ${text.length - maxChars} tekens weggelaten)`;
}

/**
 * Verdeelt het tekenbudget over de gewijzigde bestanden.
 *
 * WAAROM DIT NIET MEER EEN VASTE GRENS PER BESTAND IS
 *
 * Tot 18 september 2026 kreeg elk bestand hoogstens 4.000 tekens, naast een
 * totaalbudget van 16.000. Die eerste grens knipte ook wanneer er geen ander
 * bestand was om ruimte voor te maken. Bij PR #64 — één testbestand van 6.165
 * tekens — zag de beoordelaar er 4.000 van, terwijl er 12.000 tekens budget
 * ongebruikt bleven liggen. Hij escaleerde met als reden "de aangeleverde diff
 * is afgekapt", en dat was precies het juiste oordeel: wie de helft van een
 * wijziging ziet, hoort hem niet goed te keuren.
 *
 * Het gevolg was alleen wel dat élke pull request met één bestand groter dan
 * 4.000 tekens automatisch escaleerde, hoe klein en veilig de wijziging ook
 * was. Daarmee deed deze hele controle niet meer waarvoor ze is gebouwd — een
 * missie 's nachts laten doorlopen zonder op een klik te wachten.
 *
 * Nu krijgt elk bestand een evenredig deel van wat er van het totaal nog over
 * is. Bij één bestand is dat het hele budget; bij tien is het een tiende, en
 * wat een klein bestand niet opmaakt schuift door naar het volgende. De harde
 * grens op wat er in totaal naar het model gaat blijft ongewijzigd — dat was
 * de grens die ergens voor diende.
 */
export function buildDiffBlock(files: PullRequestFileChange[]): string {
  const blocks: string[] = [];
  let remaining = MAX_TOTAL_DIFF_CHARS;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];

    if (remaining < MIN_PATCH_CHARS_PER_FILE) {
      const omitted = files.length - index;

      blocks.push(
        `… (nog ${omitted} bestand${omitted === 1 ? "" : "en"} weggelaten, ` +
          "de diff werd te groot voor deze beoordeling)",
      );
      break;
    }

    const allowance = Math.max(
      MIN_PATCH_CHARS_PER_FILE,
      Math.floor(remaining / (files.length - index)),
    );

    const patch = file.patch
      ? truncate(file.patch, allowance)
      : "(geen diff beschikbaar voor dit bestand — waarschijnlijk een binair bestand of een hernoeming)";

    const block = `### ${file.filename} (${file.status})\n${patch}`;

    blocks.push(block);
    remaining -= block.length;
  }

  return blocks.join("\n\n");
}

function buildUserMessage(mission: MissionV2, files: PullRequestFileChange[]): string {
  const criteria = mission.successCriteria
    ?.map((criterion) => `- ${criterion.description}`)
    .join("\n") ?? "(geen succescriteria beschikbaar)";

  return `Missietitel: ${mission.title}
Doel van de missie: ${mission.objective}

Succescriteria (allemaal al GEHAALD volgens QA):
${criteria}

Gewijzigde bestanden en hun diff:
${buildDiffBlock(files)}`;
}

/**
 * Neemt, net als parseCouncilVerdict in council-texts.ts, de LAATSTE
 * herkenbare oordeel-tag in de tekst (in het onwaarschijnlijke geval dat het
 * model er per ongeluk meerdere noemt, bijvoorbeeld terwijl het hardop
 * redeneert vóór de conclusie) en behandelt alles dat geen expliciete
 * AKKOORD is — ontbrekend, dubbelzinnig, of letterlijk ESCALEREN — als
 * "niet goedgekeurd". Er bestaat bewust geen derde uitkomst: in
 * tegenstelling tot QA's UNDETERMINED (dat een aparte vraag aan Elroy
 * genereert) leidt hier alles-behalve-AKKOORD naar exact hetzelfde pad als
 * een normale needs-signoff-escalatie — er is dus geen aparte foutafhandeling
 * nodig voor "onduidelijk" versus "expliciet nee".
 */
function parseAutomatedSignoffVerdict(text: string, rawReasonSource: string): AutomatedSignoffResult {
  const matches = [...text.matchAll(VERDICT_TAG_PATTERN)];
  const last = matches[matches.length - 1];
  const verdict = last?.[1]?.toUpperCase();

  const reason = rawReasonSource.replace(VERDICT_TAG_PATTERN, "").trim() || "(geen toelichting gegeven)";

  if (verdict === "AKKOORD") {
    return { approved: true, reason };
  }

  return {
    approved: false,
    reason:
      verdict === "ESCALEREN"
        ? reason
        : `Geen herkenbaar oordeel gevonden in de beoordeling — bij twijfel escaleert dit altijd, dus geen automatische goedkeuring. Ruwe beoordeling: ${truncate(text, 1_000)}`,
  };
}

export async function reviewPullRequestForAutomatedSignoff(
  mission: MissionV2,
  files: PullRequestFileChange[],
): Promise<AutomatedSignoffResult> {
  const provider = getChatProvider();

  const completion = await provider.chatCompletion(SYSTEM_PROMPT, [
    { role: "user", content: buildUserMessage(mission, files) },
  ]);

  return parseAutomatedSignoffVerdict(completion.content, completion.content);
}
