import { afterEach, describe, expect, it, vi } from "vitest";

import type { LlmToolCall, LlmToolDefinition } from "@/core/llm/types";

import { createAnthropicProvider } from "./anthropic-provider";
import { createOpenAiProvider } from "./openai-provider";

/**
 * Tests bij stap 18 (deel 4) — de gereedschapslus.
 *
 * Dit is het riskantste stuk van die stap: twee providers die om een compleet
 * andere berichtvorm vragen, en een lus die kan blijven hangen. `fetch` wordt
 * hier volledig vervangen, zodat er geen enkele echte aanroep gedaan wordt en
 * de antwoorden precies zo gevormd kunnen worden als een provider ze
 * terugstuurt.
 *
 * Wat hier NIET getest wordt: of de modellen het gereedschap verstandig
 * gebruiken. Dat is geen eigenschap van deze code.
 */

const TOOLS: LlmToolDefinition[] = [
  {
    name: "lees_bestand",
    description: "Leest een bestand.",
    parameters: { type: "object", properties: { pad: { type: "string" } }, required: ["pad"] },
  },
];

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

/** Vervangt fetch door een rij vooraf klaargezette antwoorden. */
function stubFetch(responses: unknown[]) {
  const bodies: Record<string, unknown>[] = [];

  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return jsonResponse(responses[bodies.length - 1]);
  });

  vi.stubGlobal("fetch", fetchMock);

  return { bodies, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Anthropic — gereedschapslus", () => {
  const anthropicToolUse = {
    stop_reason: "tool_use",
    content: [
      { type: "text", text: "Ik kijk even." },
      { type: "tool_use", id: "tu_1", name: "lees_bestand", input: { pad: "src/a.ts" } },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
  };

  const anthropicFinal = {
    stop_reason: "end_turn",
    content: [{ type: "text", text: "export const a = 1;" }],
    usage: { input_tokens: 20, output_tokens: 8 },
  };

  it("voert het gereedschap uit en geeft daarna het echte antwoord", async () => {
    const { bodies } = stubFetch([anthropicToolUse, anthropicFinal]);
    const calls: LlmToolCall[] = [];

    const result = await createAnthropicProvider("sleutel", "model-x").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "schrijf iets" }],
      {
        tools: TOOLS,
        runTool: async (call) => {
          calls.push(call);
          return "inhoud van src/a.ts";
        },
      },
    );

    expect(result.content).toBe("export const a = 1;");
    expect(calls).toEqual([
      { id: "tu_1", name: "lees_bestand", arguments: { pad: "src/a.ts" } },
    ]);
    expect(bodies).toHaveLength(2);
  });

  it("stuurt het eigen antwoord én het resultaat terug in de tweede ronde", async () => {
    // Anthropic verwacht dat het model zijn eigen tool_use terugziet, anders
    // kan het het resultaat er niet aan koppelen.
    const { bodies } = stubFetch([anthropicToolUse, anthropicFinal]);

    await createAnthropicProvider("sleutel", "model-x").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "schrijf iets" }],
      { tools: TOOLS, runTool: async () => "inhoud" },
    );

    const tweede = bodies[1].messages as { role: string; content: unknown }[];

    expect(tweede).toHaveLength(3);
    expect(tweede[1].role).toBe("assistant");
    expect(JSON.stringify(tweede[2])).toContain("tool_result");
    expect(JSON.stringify(tweede[2])).toContain("tu_1");
  });

  it("telt het tokengebruik van alle rondes bij elkaar op", async () => {
    // Anders zou de kostenschatting alleen de laatste ronde meenemen.
    stubFetch([anthropicToolUse, anthropicFinal]);

    const result = await createAnthropicProvider("sleutel", "model-x").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "x" }],
      { tools: TOOLS, runTool: async () => "inhoud" },
    );

    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 13 });
  });

  /**
   * De belangrijkste test van dit bestand: de lus mag niet eindeloos door
   * kunnen gaan. De laatste ronde gaat bewust zónder gereedschap de deur uit,
   * zodat er altijd een echt antwoord uit komt.
   */
  it("gaat de laatste ronde in zonder gereedschap", async () => {
    const { bodies } = stubFetch([anthropicToolUse, anthropicToolUse, anthropicFinal]);

    const result = await createAnthropicProvider("sleutel", "model-x").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "x" }],
      { tools: TOOLS, runTool: async () => "inhoud", maxToolRounds: 2 },
    );

    expect(result.content).toBe("export const a = 1;");
    expect(bodies[0]).toHaveProperty("tools");
    expect(bodies[1]).toHaveProperty("tools");
    expect(bodies[2]).not.toHaveProperty("tools");
  });

  it("werkt ook wanneer er helemaal geen gereedschap gevraagd wordt", async () => {
    stubFetch([anthropicFinal]);

    const result = await createAnthropicProvider("sleutel", "model-x").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "x" }],
      { tools: TOOLS, runTool: async () => "nooit" },
    );

    expect(result.content).toBe("export const a = 1;");
  });
});

/**
 * OpenAI loopt over de Responses API (`/v1/responses`) in plaats van de
 * chat-API. Reden: redenerende modellen als gpt-6-astra weigeren function
 * tools op `/v1/chat/completions`, en de uitweg die OpenAI's eigen
 * foutmelding noemt (`reasoning_effort: 'none'`) accepteert dat model niet.
 * Zie de toelichting in openai-provider.ts.
 */
describe("OpenAI — gereedschapslus over de Responses API", () => {
  const openAiToolCall = {
    status: "completed",
    output: [
      { type: "reasoning", id: "rs_1", summary: [] },
      {
        type: "function_call",
        call_id: "call_1",
        name: "lees_bestand",
        arguments: '{"pad":"src/a.ts"}',
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
  };

  const openAiFinal = {
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: "export const a = 1;" }] }],
    usage: { input_tokens: 20, output_tokens: 8 },
  };

  it("praat met /v1/responses en niet met /v1/chat/completions", async () => {
    // Dit is de hele reden dat deze lus apart bestaat.
    const { fetchMock } = stubFetch([openAiFinal]);

    await createOpenAiProvider("sleutel", "model-y").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "x" }],
      { tools: TOOLS, runTool: async () => "nooit" },
    );

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
  });

  it("voert het gereedschap uit en geeft daarna het echte antwoord", async () => {
    stubFetch([openAiToolCall, openAiFinal]);
    const calls: LlmToolCall[] = [];

    const result = await createOpenAiProvider("sleutel", "model-y").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "schrijf iets" }],
      {
        tools: TOOLS,
        runTool: async (call) => {
          calls.push(call);
          return "inhoud";
        },
      },
    );

    expect(result.content).toBe("export const a = 1;");
    expect(calls[0]).toEqual({
      id: "call_1",
      name: "lees_bestand",
      arguments: { pad: "src/a.ts" },
    });
  });

  it("stuurt de systeemprompt als instructions en de gereedschappen plat", async () => {
    // De Responses API wil geen "system"-bericht en geen tools genest onder
    // "function" — dat is precies waar de chat-API wél om vraagt.
    const { bodies } = stubFetch([openAiFinal]);

    await createOpenAiProvider("sleutel", "model-y").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "x" }],
      { tools: TOOLS, runTool: async () => "nooit" },
    );

    expect(bodies[0].instructions).toBe("systeem");
    expect(bodies[0]).toHaveProperty("input");
    expect(bodies[0]).not.toHaveProperty("messages");
    expect((bodies[0].tools as Record<string, unknown>[])[0]).toMatchObject({
      type: "function",
      name: "lees_bestand",
    });
  });

  /**
   * De belangrijkste van dit blok. Gooi je de redeneerstappen weg tussen twee
   * rondes, dan verliest het model zijn eigen gedachtegang en begint het elke
   * ronde opnieuw.
   */
  it("stuurt het volledige antwoord inclusief redeneerstappen terug", async () => {
    const { bodies } = stubFetch([openAiToolCall, openAiFinal]);

    await createOpenAiProvider("sleutel", "model-y").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "x" }],
      { tools: TOOLS, runTool: async () => "inhoud van a" },
    );

    const tweede = bodies[1].input as Record<string, unknown>[];

    expect(tweede.some((item) => item.type === "reasoning")).toBe(true);
    expect(tweede.some((item) => item.type === "function_call")).toBe(true);
    expect(tweede.at(-1)).toEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: "inhoud van a",
    });
  });

  /**
   * OpenAI geeft de argumenten als JSON-TEKST terug. Een model dat daar iets
   * ongeldigs van maakt, mag de toewijzing niet laten vallen: het gereedschap
   * klaagt dan zelf, en die klacht gaat als tekst terug naar het model.
   */
  it("laat ongeldige argumenten niet crashen", async () => {
    stubFetch([
      {
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "lees_bestand",
            arguments: "{kapot",
          },
        ],
      },
      openAiFinal,
    ]);

    const calls: LlmToolCall[] = [];

    const result = await createOpenAiProvider("sleutel", "model-y").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "x" }],
      {
        tools: TOOLS,
        runTool: async (call) => {
          calls.push(call);
          return "geef een pad mee";
        },
      },
    );

    expect(calls[0].arguments).toEqual({});
    expect(result.content).toBe("export const a = 1;");
  });

  it("telt het tokengebruik van alle rondes bij elkaar op", async () => {
    stubFetch([openAiToolCall, openAiFinal]);

    const result = await createOpenAiProvider("sleutel", "model-y").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "x" }],
      { tools: TOOLS, runTool: async () => "inhoud" },
    );

    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 13 });
  });

  it("gaat de laatste ronde in zonder gereedschap", async () => {
    const { bodies } = stubFetch([openAiToolCall, openAiToolCall, openAiFinal]);

    await createOpenAiProvider("sleutel", "model-y").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "x" }],
      { tools: TOOLS, runTool: async () => "inhoud", maxToolRounds: 2 },
    );

    expect(bodies[0]).toHaveProperty("tools");
    expect(bodies[2]).not.toHaveProperty("tools");
  });

  it("gebruikt output_text wanneer de provider die meestuurt", async () => {
    stubFetch([{ status: "completed", output: [], output_text: "klaar" }]);

    const result = await createOpenAiProvider("sleutel", "model-y").chatCompletionWithTools!(
      "systeem",
      [{ role: "user", content: "x" }],
      { tools: TOOLS, runTool: async () => "nooit" },
    );

    expect(result.content).toBe("klaar");
  });

  it("blijft voor een gewone aanroep de chat-API gebruiken", async () => {
    // Elke rol die géén gereedschap gebruikt — Director, QA, de Council —
    // hoort van deze hele wijziging niets te merken.
    const { fetchMock } = stubFetch([
      { choices: [{ finish_reason: "stop", message: { content: "gewoon" } }] },
    ]);

    const result = await createOpenAiProvider("sleutel", "model-y").chatCompletion("systeem", [
      { role: "user", content: "x" },
    ]);

    expect(result.content).toBe("gewoon");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
  });
});
