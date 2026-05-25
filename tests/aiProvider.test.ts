import { describe, expect, test } from "vitest";
import { MockAIProvider, enrichWithProvider } from "../src/ai/mockProvider.js";
import { OpenAICompatibleProvider } from "../src/ai/openAiCompatibleProvider.js";
import { createAIProvider } from "../src/ai/providerFactory.js";
import { AIResponseValidationError, articleEntrySchema, classificationSchema, groupedArticleEntriesSchema, parseAiJsonResponse } from "../src/ai/schemas.js";
import type { NewsItem } from "../src/pipeline/types.js";

describe("MockAIProvider", () => {
  test("returns deterministic structured results for AI x game items", async () => {
    const provider = new MockAIProvider();
    const item = createItem("ai-game", richPixel2PlayContent);

    const classification = await provider.classifyAndFilter(item, { minCrossRelevanceScore: 60 });
    const summary = await provider.summarize(item);
    const keywords = await provider.extractKeywords(item);
    const article = await provider.generateArticleEntry(item);
    const voiceover = await provider.generateVoiceoverScript([{ ...item, articleTitle: article.title, introSummary: summary.introSummary }]);

    expect(classification.isTopicCandidate).toBe(true);
    expect(classification.exclusionReasons).toEqual([]);
    expect(classification.newsValueScore).toBeGreaterThanOrEqual(55);
    expect(classification.crossRelevanceScore).toBeGreaterThanOrEqual(60);
    expect(summary.summary).toContain("Pixel2Play");
    expect(keywords.keywords).toContain("AI");
    expect(article.title).toContain("Pixel2Play");
    expect(voiceover.segments[0]).toContain("Pixel2Play");
  });

  test("rejects sparse AI x game mentions before daily selection", async () => {
    const provider = new MockAIProvider();
    const item = createItem("sparse", "A game studio released AI-assisted NPC tools for live operations.");

    const classification = await provider.classifyAndFilter(item, { minCrossRelevanceScore: 60 });

    expect(classification.isTopicCandidate).toBe(false);
    expect(classification.exclusionReasons).toContain("low-information item");
  });

  test("enriches items without selecting duplicates", async () => {
    const provider = new MockAIProvider();
    const duplicate = createItem("duplicate", richPixel2PlayContent);
    duplicate.duplicateOf = "canonical";

    const [enriched] = await enrichWithProvider(provider, [duplicate], { minCrossRelevanceScore: 60 });

    expect(enriched?.isTopicCandidate).toBe(true);
    expect(enriched?.selected).toBe(false);
    expect(enriched?.articleTitle).toContain("Pixel2Play");
  });

  test("excludes a single item when provider enrichment fails", async () => {
    const provider = {
      classifyAndFilter: async () => {
        throw new Error("bad model output");
      },
      summarize: async () => ({ summary: "ok", introSummary: "ok" }),
      extractKeywords: async () => ({ keywords: [] }),
      scoreRelevance: async () => ({ aiRelevanceScore: 0, gameRelevanceScore: 0, crossRelevanceScore: 0 }),
      generateArticleEntry: async () => ({ title: "ok", body: "ok", category: "AI x Game", officialSources: [] }),
      generateArticleEntries: async () => ({ entries: [] }),
      formatMarkdown: async () => ({ markdown: "ok" }),
      generateVoiceoverScript: async () => ({ segments: [] })
    };

    const [enriched] = await enrichWithProvider(provider, [createItem("bad", richPixel2PlayContent)], { minCrossRelevanceScore: 60 });

    expect(enriched?.selected).toBe(false);
    expect(enriched?.isTopicCandidate).toBe(false);
    expect(enriched?.exclusionReason).toContain("ai enrichment failed");
  });
});

const richPixel2PlayContent = [
  "Open-P2P团队发布新一代实时通用游戏AI Pixel2Play，以游戏画面和文本指令作为输入，输出可执行的操作信号，消费级显卡可实现超过20Hz实时交互。",
  "训练数据覆盖40多款游戏、8300小时以上游玩记录，支持零样本操作Roblox和Steam游戏，并开源全部代码与数据集。",
  "模型采用轻量级Transformer与action-decoder架构，参数量覆盖150M到1.2B，最大模型推理速度约40Hz，指令遵循任务通过率从20%提升到80%。"
].join("\n");

describe("AI response validation", () => {
  test("parses fenced JSON and validates schema", () => {
    const result = parseAiJsonResponse(
      "```json\n{\"newsValueScore\":80,\"aiRelevanceScore\":90,\"gameRelevanceScore\":70,\"crossRelevanceScore\":75,\"isTopicCandidate\":true,\"exclusionReasons\":[],\"aiTags\":[\"tooling\"],\"gameTags\":[\"development\"]}\n```",
      classificationSchema
    );

    expect(result.crossRelevanceScore).toBe(75);
  });

  test("throws on malformed JSON", () => {
    expect(() => parseAiJsonResponse("{not json", classificationSchema)).toThrow(AIResponseValidationError);
  });

  test("throws on schema violations", () => {
    expect(() =>
      parseAiJsonResponse(
        "{\"newsValueScore\":101,\"aiRelevanceScore\":90,\"gameRelevanceScore\":70,\"crossRelevanceScore\":75,\"isTopicCandidate\":true,\"exclusionReasons\":[],\"aiTags\":[],\"gameTags\":[]}",
        classificationSchema
      )
    ).toThrow(/schema validation/);
  });

  test("accepts model-supplied source strings for downstream cleanup", () => {
    const article = parseAiJsonResponse(
      "{\"title\":\"t\",\"body\":\"b\",\"category\":\"AI x Game\",\"officialSources\":[\"https://example.com/story\",\"not a url\"]}",
      articleEntrySchema
    );
    const grouped = parseAiJsonResponse(
      "{\"entries\":[{\"id\":\"item-1\",\"articleTitle\":\"t\",\"articleBody\":\"b\",\"introSummary\":\"点评\",\"sourceLinks\":[\"invalid\",\"https://example.com/source\"]}]}",
      groupedArticleEntriesSchema
    );

    expect(article.officialSources).toEqual(["https://example.com/story", "not a url"]);
    expect(grouped.entries[0]?.sourceLinks).toEqual(["invalid", "https://example.com/source"]);
  });

  test("extracts the first complete JSON object when trailing commentary exists", () => {
    const result = parseAiJsonResponse(
      [
        "Here is the requested object:",
        "{\"newsValueScore\":80,\"aiRelevanceScore\":90,\"gameRelevanceScore\":70,\"crossRelevanceScore\":75,\"isTopicCandidate\":true,\"exclusionReasons\":[],\"aiTags\":[\"tooling\"],\"gameTags\":[\"development\"]}",
        "Extra note with braces {ignored}"
      ].join("\n"),
      classificationSchema
    );

    expect(result.crossRelevanceScore).toBe(75);
  });

  test("accepts singleton arrays when a model wraps an object response", () => {
    const result = parseAiJsonResponse(
      "[{\"newsValueScore\":80,\"aiRelevanceScore\":90,\"gameRelevanceScore\":70,\"crossRelevanceScore\":75,\"isTopicCandidate\":true,\"exclusionReasons\":[],\"aiTags\":[\"tooling\"],\"gameTags\":[\"development\"]}]",
      classificationSchema
    );

    expect(result.isTopicCandidate).toBe(true);
  });

  test("uses the first JSON segment that matches the requested schema", () => {
    const result = parseAiJsonResponse(
      [
        "[\"not\", \"the\", \"schema\"]",
        "{\"newsValueScore\":80,\"aiRelevanceScore\":90,\"gameRelevanceScore\":70,\"crossRelevanceScore\":75,\"isTopicCandidate\":true,\"exclusionReasons\":[],\"aiTags\":[\"tooling\"],\"gameTags\":[\"development\"]}"
      ].join("\n"),
      classificationSchema
    );

    expect(result.crossRelevanceScore).toBe(75);
  });
});

describe("createAIProvider", () => {
  test("defaults to mock provider without paid API credentials", () => {
    expect(createAIProvider({ MODEL_PROVIDER: "mock" })).toBeInstanceOf(MockAIProvider);
  });

  test("requires env credentials for OpenAI-compatible provider", () => {
    expect(() => createAIProvider({ MODEL_PROVIDER: "openai" }, {})).toThrow(/OPENAI_COMPATIBLE_API_KEY/);
  });
});

describe("OpenAICompatibleProvider", () => {
  test("uses relay defaults when configured with OPENAI_COMPATIBLE_API_KEY", async () => {
    const requests: Array<{ input: string | URL | Request; body: unknown }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ input, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "{\"summary\":\"ok\",\"introSummary\":\"ok\"}" } }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const provider = OpenAICompatibleProvider.fromEnv({ OPENAI_COMPATIBLE_API_KEY: "test-key" });
      await expect(provider?.summarize(createItem("relay", "AI game update"))).resolves.toEqual({
        summary: "ok",
        introSummary: "ok"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(String(requests[0]?.input)).toBe("https://api.openai.com/v1/chat/completions");
    expect(requests[0]?.body).toMatchObject({ model: "gemini-3-flash-preview" });
  });

  test("accepts LLM_TOKEN and LLM_MODEL aliases for relay configuration", async () => {
    const requests: Array<{ input: string | URL | Request; body: unknown }> = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ input, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "{\"summary\":\"ok\",\"introSummary\":\"ok\"}" } }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const provider = OpenAICompatibleProvider.fromEnv({
        LLM_TOKEN: "test-key",
        LLM_BASE_URL: "https://relay.example/v1",
        LLM_MODEL: "alias-model"
      });
      await expect(provider?.summarize(createItem("relay", "AI game update"))).resolves.toEqual({
        summary: "ok",
        introSummary: "ok"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(String(requests[0]?.input)).toBe("https://relay.example/v1/chat/completions");
    expect(requests[0]?.body).toMatchObject({ model: "alias-model" });
  });

  test("retries without response_format when a compatible relay rejects it", async () => {
    const requests: unknown[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));

      if (requests.length === 1) {
        return new Response(JSON.stringify({ error: { message: "response_format is not supported" } }), {
          status: 400,
          statusText: "Bad Request",
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: "{\"summary\":\"ok\",\"introSummary\":\"ok\"}" } }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: "test-key",
        baseUrl: "https://relay.example/v1",
        model: "relay-model"
      });
      await expect(provider.summarize(createItem("relay", "AI game update"))).resolves.toEqual({
        summary: "ok",
        introSummary: "ok"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ response_format: { type: "json_object" } });
    expect(requests[1]).not.toHaveProperty("response_format");
  });

  test("accepts OpenAI-compatible text content parts", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async () => new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: "text", text: "{\"summary\":\"ok\",\"introSummary\":\"ok\"}" }] } }]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })) as typeof fetch;

    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: "test-key",
        baseUrl: "https://relay.example/v1",
        model: "relay-model"
      });
      await expect(provider.summarize(createItem("relay", "AI game update"))).resolves.toEqual({
        summary: "ok",
        introSummary: "ok"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function createItem(id: string, rawContent: string): NewsItem {
  const now = "2026-05-19T00:00:00.000Z";

  return {
    id,
    sourceName: "Example",
    sourceType: "ai_game_media",
    sourceWeight: 90,
    sourceUrl: `https://example.com/${id}`,
    rawContent,
    publishedAt: now,
    collectedAt: now,
    summary: "",
    keywords: [],
    category: "",
    score: 0,
    newsValueScore: 0,
    duplicateOf: null,
    selected: false,
    officialSources: [],
    articleTitle: "",
    articleBody: "",
    introSummary: "",
    assets: [],
    scriptSegments: [],
    ttsSegments: [],
    timeline: [],
    subtitleSrt: "",
    aiRelevanceScore: 0,
    gameRelevanceScore: 0,
    crossRelevanceScore: 0,
    aiTags: [],
    gameTags: [],
    isTopicCandidate: false,
    exclusionReason: ""
  };
}
