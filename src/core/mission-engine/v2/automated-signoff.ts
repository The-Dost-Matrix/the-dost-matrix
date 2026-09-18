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
 * (niet alleen bestandsnamen) en alleen goedkeurt bij oprecht vertrouwen.
 * Het vervangt geen van de bestaande vangnetten: CI moet nog steeds groen
 * zijn en alle succescriteria moeten nog steeds PASSED zijn vóórdat
 * ensureMissionPullRequestMerged (director-runtime.ts) dit hier zelfs
 * aanroept, en een aparte, hardere categorie wijzigingen (zie
 * findHardEscalationReason in risk-classification.ts) komt hier nooit
 * binnen — die escaleert altijd naar Elroy, ongeacht wat deze beoordeling
 * zou zeggen.
 *
 * Dezelfde "eerlijke twijfel"-discipline als QA's UNDETERMINED (stap 12b) en
 * de Raad's ONDUIDELIJK (stap 13): een ontbrekend, dubbelzinnig of
 * onleesbaar oordeel telt NOOIT als goedkeuring. Bij twijfel escaleert dit
 * naar Elroy — precies zoals een needs-signoff-classificatie vóór deze stap
 * altijd deed. Deze functie kan de bestaande veiligheid dus alleen
 * versoepelen richting "automatisch mergen na een tweede, oprechte
 * beoordeling", nooit richting "mergen zonder enige beoordeling".
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

const SYSTEM_PROMPT = `Je bent de laatste, geautomatiseerde controle voordat een pull request
automatisch wordt gemerged in de eigen codebase van The Dost Matrix, ZONDER
dat de eigenaar (Elroy) hem zelf heeft bekeken. Elroy heeft deze
beoordeling bewust aan jou overgedragen omdat hij geen programmeerachter-
grond heeft — jij bent hier de enige echte blik vóór het mergen.

Context: alle succescriteria van de missie staan al op GEHAALD (QA heeft ze
goedgekeurd) en de CI-checks zijn al groen. Die twee zijn dus geen reden meer
om te twijfelen — jouw taak is een ANDERE vraag: zou een zorgvuldige senior
reviewer, die deze diff met eigen ogen ziet, hem zonder aarzelen mergen?

Let specifiek op:
- Doet de wijziging school precies wat de missie vraagt, niet meer en niet
  minder (geen ongevraagde bijwerkingen elders in de diff)?
- Niets dat op een fout, een half afgemaakte gedachte, of een verzonnen
  aanname lijkt, ook al haalt het de typecheck en de tests.
- Niets dat, als het toch fout blijkt te zijn, moeilijk terug te draaien is.

Twijfel je, ook maar een beetje? Kies dan ESCALEREN — dat is geen falen, dat
is precies waar deze controle voor bestaat. Alleen bij oprecht vertrouwen
kies je AKKOORD. Sluit je antwoord ALTIJD af met exact één van deze twee
regels, verder niets erna:
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
