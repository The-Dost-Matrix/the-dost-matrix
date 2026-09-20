import { describe, expect, it } from "vitest";
import {
  buildCouncilRoundOneUserMessage,
  buildCouncilRoundTwoUserMessage,
  formatCouncilResultForChat,
  parseCouncilVerdict,
} from "./council-texts";
import type { CouncilSessionResult } from "./council-texts";

describe("parseCouncilVerdict", () => {
  it("herkent EENS", () => {
    expect(parseCouncilVerdict("Prima onderbouwd.\n<oordeel>EENS</oordeel>")).toBe("EENS");
  });

  it("herkent ONEENS", () => {
    expect(parseCouncilVerdict("Dat klopt niet.\n<oordeel>ONEENS</oordeel>")).toBe("ONEENS");
  });

  it("is ongevoelig voor hoofdletters en spaties in de tag", () => {
    expect(parseCouncilVerdict("<oordeel> eens </oordeel>")).toBe("EENS");
  });

  it("geeft ONDUIDELIJK wanneer de tag ontbreekt", () => {
    expect(parseCouncilVerdict("Ik ben het er eigenlijk wel mee eens.")).toBe("ONDUIDELIJK");
  });

  it("neemt de LAATSTE tag wanneer de tekst de tagvorm eerder al noemt", () => {
    const text =
      "Je vraagt me af te sluiten met <oordeel>EENS</oordeel> of <oordeel>ONEENS</oordeel>. " +
      "Na overweging: <oordeel>ONEENS</oordeel>";
    expect(parseCouncilVerdict(text)).toBe("ONEENS");
  });

  it("geeft ONDUIDELIJK bij een niet-herkende waarde in de tag", () => {
    expect(parseCouncilVerdict("<oordeel>MISSCHIEN</oordeel>")).toBe("ONDUIDELIJK");
  });
});

describe("buildCouncilRoundOneUserMessage", () => {
  it("bevat zowel de projectstand als de vraag, duidelijk gescheiden", () => {
    const message = buildCouncilRoundOneUserMessage("Moeten we X doen?", "ROADMAP-INHOUD");
    expect(message).toContain("ROADMAP-INHOUD");
    expect(message).toContain("Moeten we X doen?");
    expect(message.indexOf("ROADMAP-INHOUD")).toBeLessThan(message.indexOf("Moeten we X doen?"));
  });
});

describe("buildCouncilRoundTwoUserMessage", () => {
  it("bevat het standpunt van het andere lid, zonder providernaam te introduceren", () => {
    const message = buildCouncilRoundTwoUserMessage(
      "Moeten we stap 16 nu al doen?",
      "PROJECTSTAND: drie missies voltooid.",
      "Ik denk dat optie A beter is omdat...",
    );
    expect(message).toContain("Ik denk dat optie A beter is omdat...");
    expect(message.toLowerCase()).not.toContain("anthropic");
    expect(message.toLowerCase()).not.toContain("openai");
  });

  /**
   * Bevinding F-05 (externe review, 20 september 2026): ronde 2 kreeg alleen
   * de analyse van het andere lid, zonder de vraag en zonder de projectstand.
   * Kritiek zonder bewijsbasis is een gesprek over een tekst in plaats van
   * over de zaak.
   */
  it("geeft ook de oorspronkelijke vraag en de projectstand mee", () => {
    const message = buildCouncilRoundTwoUserMessage(
      "Moeten we stap 16 nu al doen?",
      "PROJECTSTAND: drie missies voltooid.",
      "Ik denk dat optie A beter is omdat...",
    );

    expect(message).toContain("Moeten we stap 16 nu al doen?");
    expect(message).toContain("drie missies voltooid");
  });
});

describe("formatCouncilResultForChat", () => {
  function buildResult(overrides: Partial<CouncilSessionResult> = {}): CouncilSessionResult {
    return {
      question: "Moeten we stap 16 nu al doen?",
      members: [
        {
          providerId: "anthropic",
          model: "anthropic/claude-sonnet-5",
          analysis: "Standpunt van lid 1.",
          critique: "Kritiek van lid 1.\n<oordeel>EENS</oordeel>",
          verdict: "EENS",
        },
        {
          providerId: "openai",
          model: "openai/gpt-4o",
          analysis: "Standpunt van lid 2.",
          critique: "Kritiek van lid 2.\n<oordeel>EENS</oordeel>",
          verdict: "EENS",
        },
      ],
      agreement: true,
      estimatedCostUsd: 0.0123,
      ...overrides,
    };
  }

  it("toont bij overeenstemming een duidelijke EENS-kop en geen samengevoegd advies", () => {
    const text = formatCouncilResultForChat(buildResult());
    expect(text).toContain("de raad is het eens");
    expect(text).toContain("Standpunt van lid 1.");
    expect(text).toContain("Standpunt van lid 2.");
    expect(text).toContain("Moeten we stap 16 nu al doen?");
  });

  it("toont bij onenigheid beide volledige standpunten, niet één synthese", () => {
    const result = buildResult({
      agreement: false,
      members: [
        {
          providerId: "anthropic",
          model: "anthropic/claude-sonnet-5",
          analysis: "Lid 1 vindt dat we moeten wachten.",
          critique: "Ik blijf het oneens.\n<oordeel>ONEENS</oordeel>",
          verdict: "ONEENS",
        },
        {
          providerId: "openai",
          model: "openai/gpt-4o",
          analysis: "Lid 2 vindt dat we nu moeten beginnen.",
          critique: "Ik ben het ermee eens.\n<oordeel>EENS</oordeel>",
          verdict: "EENS",
        },
      ],
    });

    const text = formatCouncilResultForChat(result);
    expect(text).toContain("de raad is het NIET eens");
    expect(text).toContain("Lid 1 vindt dat we moeten wachten.");
    expect(text).toContain("Lid 2 vindt dat we nu moeten beginnen.");
    expect(text).toContain("bewust niet opgelost tot één advies");
  });

  it("laat een ONDUIDELIJK oordeel expliciet zien in plaats van het als eens te tellen", () => {
    const result = buildResult({
      agreement: false,
      members: [
        {
          providerId: "anthropic",
          model: "anthropic/claude-sonnet-5",
          analysis: "Lid 1 analyse.",
          critique: "Geen duidelijke conclusie.",
          verdict: "ONDUIDELIJK",
        },
        {
          providerId: "openai",
          model: "openai/gpt-4o",
          analysis: "Lid 2 analyse.",
          critique: "Ik ben het ermee eens.\n<oordeel>EENS</oordeel>",
          verdict: "EENS",
        },
      ],
    });

    expect(formatCouncilResultForChat(result)).toContain("ONDUIDELIJK (geen leesbaar oordeel gevonden)");
  });

  it("toont de geschatte kosten als informatief, niet als blokkerend", () => {
    const text = formatCouncilResultForChat(buildResult({ estimatedCostUsd: 0.4567 }));
    expect(text).toContain("~$0.4567");
    expect(text).toContain("blokkeert niets");
  });
});
