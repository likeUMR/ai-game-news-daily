import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type {
  ArticleEntryResult,
  ClassificationResult,
  GroupedArticleEntriesResult,
  KeywordsResult,
  MarkdownResult,
  RelevanceScoreResult,
  SummaryResult,
  VoiceoverScriptResult
} from "../src/ai/schemas.js";
import type { AIProvider, ArticleGenerationContextGroup, ClassificationOptions } from "../src/ai/types.js";
import { openNewsRepository, type NewsRepository } from "../src/db/newsRepository.js";
import { generateArticlesForSelectedItems } from "../src/pipeline/articleGeneration.js";
import type { NewsItem, SourceType } from "../src/pipeline/types.js";

let tempDir: string | undefined;
let repository: NewsRepository | undefined;

afterEach(async () => {
  repository?.close();
  repository = undefined;

  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("generateArticlesForSelectedItems", () => {
  test("groups selected items by category before AI generation", async () => {
    repository = await createRepository();
    const provider = new RecordingProvider();
    const items = [
      persist(createItem("ai", { category: "AI x Game" })),
      persist(createItem("engine", { category: "Engine" })),
      persist(createItem("skip", { selected: false, category: "AI x Game" }))
    ];

    const result = await generateArticlesForSelectedItems(repository, provider, items);

    expect(provider.groups.map((group) => [group.category, group.items.map((item) => item.id)])).toEqual([
      ["AI x Game", ["ai"]],
      ["Engine", ["engine"]]
    ]);
    expect(result.generated).toBe(2);
    expect(result.items.find((item) => item.id === "skip")?.articleTitle).toBe("AI tooling moves deeper into game production");
  });

  test("preserves source links for every selected item", async () => {
    repository = await createRepository();
    const item = persist(createItem("source", {
      sourceUrl: "https://media.example.com/source",
      officialSources: ["https://studio.example.com/source"]
    }));
    const provider = new RecordingProvider({
      source: {
        articleTitle: "AI NPC tooling ships for game teams",
        articleBody: "1. AI NPC tooling ships for game teams with production details from Studio News.\n2. The update focuses on tooling, NPC, and production rollout.\n3. Teams can now watch for concrete adoption impact.",
        introSummary: "AI NPC工具进了生产线，这回游戏团队不是玩概念而是真要改流程！",
        sourceLinks: ["https://studio.example.com/source"]
      }
    });

    const result = await generateArticlesForSelectedItems(repository, provider, [item]);
    const generated = result.items[0]!;

    expect(generated.officialSources).toEqual([
      "https://studio.example.com/source",
      "https://media.example.com/source"
    ]);
    expect(repository.getProcessedItem("source")?.officialSources).toEqual(generated.officialSources);
  });

  test("accepts canonical-equivalent generated source links", async () => {
    repository = await createRepository();
    const item = persist(createItem("canonical-source", {
      sourceUrl: "https://media.example.com/source?utm_source=newsletter#comments",
      officialSources: []
    }));
    const provider = new RecordingProvider({
      "canonical-source": {
        articleTitle: "AI NPC tooling ships for game teams",
        articleBody: "1. Studio News says AI NPC tooling ships for game live operations and narrative testing.\n2. The rollout is tied to production and operations use cases.\n3. It is worth watching downstream adoption.",
        introSummary: "AI NPC开始接进运营和叙事测试，游戏AI终于摸到真实产线了！",
        sourceLinks: ["https://media.example.com/source"]
      }
    });

    const result = await generateArticlesForSelectedItems(repository, provider, [item]);

    expect(result.generated).toBe(1);
    expect(result.fallback).toBe(0);
    expect(result.items[0]?.officialSources).toEqual(["https://media.example.com/source"]);
  });

  test("falls back to evidence-only article fields for low-quality generated articles", async () => {
    repository = await createRepository();
    const item = persist(createItem("bad"));
    const provider = new RecordingProvider({
      bad: {
        articleTitle: "",
        articleBody: "Quantum cloud robots acquired holographic satellite advertising infrastructure.".repeat(12),
        introSummary: "",
        sourceLinks: []
      }
    });

    const result = await generateArticlesForSelectedItems(repository, provider, [item]);
    const generated = result.items[0]!;

    expect(result.generated).toBe(0);
    expect(result.fallback).toBe(1);
    expect(result.validationFailures[0]?.reasons).toEqual(expect.arrayContaining([
      "article title is empty",
      "source links are missing",
      "article body must contain exactly 3 numbered points"
    ]));
    expect(generated.articleTitle).toContain("Studio News reports");
    expect(generated.articleBody).toContain("AI-assisted NPC tooling");
  });

  test("persists generated article fields to the database", async () => {
    repository = await createRepository();
    const item = persist(createItem("persist"));
    const provider = new RecordingProvider({
      persist: {
        articleTitle: "AI tooling moves deeper into game production",
        articleBody: "1. Studio News says AI NPC tooling ships for game live operations and narrative testing.\n2. The rollout centers on NPC and tooling workflows.\n3. Follow-up impact is worth watching.",
        introSummary: "AI NPC工具进了日常运营，这波游戏AI终于从演示台走到工位上了！",
        sourceLinks: ["https://example.com/persist"]
      }
    });

    await generateArticlesForSelectedItems(repository, provider, [item]);
    const reloaded = repository.getProcessedItem("persist");

    expect(reloaded).toMatchObject({
      articleTitle: "AI tooling moves deeper into game production",
      articleBody: "1. Studio News says AI NPC tooling ships for game live operations and narrative testing.\n2. The rollout centers on NPC and tooling workflows.\n3. Follow-up impact is worth watching.",
      introSummary: "AI NPC工具进了日常运营，这波游戏AI终于从演示台走到工位上了！",
      officialSources: ["https://example.com/persist"]
    });
  });

  test("normalizes commentary to one short sentence", async () => {
    repository = await createRepository();
    const item = persist(createItem("normalize"));
    const provider = new RecordingProvider({
      normalize: {
        articleTitle: "AI tooling moves deeper into game production",
        articleBody: "1. Studio News reports AI-assisted NPC tooling for game live operations and narrative testing.\n2. The update focuses on NPC tooling and studio workflows.\n3. Ongoing production impact should be monitored.",
        introSummary: "点评：这说明AI工具开始深入研发流程；后续还值得关注更多团队跟进。",
        sourceLinks: ["https://example.com/normalize"]
      }
    });

    const result = await generateArticlesForSelectedItems(repository, provider, [item]);

    expect(result.generated).toBe(1);
    expect(result.items[0]?.introSummary).toBe("这说明AI工具开始深入研发流程，后续还值得关注更多团队跟进。");
  });

  test("accepts Chinese few-shot style generated entries with preserved source links", async () => {
    repository = await createRepository();
    const item = persist(createItem("chinese-entry"));
    const provider = new RecordingProvider({
      "chinese-entry": {
        articleTitle: "游戏工作室上线智能角色工具，接入运营和叙事测试",
        articleBody: "1. 一家游戏工作室发布智能角色工具，用于实时运营和叙事测试。\n2. 这次更新重点落在工具链、工作流、开发和运营环节。\n3. 后续可继续观察它会先提升研发效率，还是进入长期内容运营。",
        introSummary: "智能角色工具进了产线，这波游戏智能化终于不只是在演示了！",
        sourceLinks: ["https://example.com/chinese-entry"]
      }
    });

    const result = await generateArticlesForSelectedItems(repository, provider, [item]);

    expect(result.generated).toBe(1);
    expect(result.items[0]?.introSummary).toBe("智能角色工具进了产线，这波游戏智能化终于不只是在演示了！");
  });

  test("accepts Chinese entries with source-backed English terms", async () => {
    repository = await createRepository();
    const item = persist(createItem("mixed-language", { sourceName: "GameLook AI" }));
    const provider = new RecordingProvider({
      "mixed-language": {
        articleTitle: "GameLook关注智能角色工具进入游戏运营流程",
        articleBody: "1. GameLook报道，一家游戏工作室发布智能角色工具，用于实时运营和叙事测试。\n2. 这次更新重点落在工具链、工作流、开发和运营环节。\n3. 后续可继续观察它会先提升研发效率，还是进入长期内容运营。",
        introSummary: "GameLook盯到产线变化，这波游戏智能化终于不是概念演示了！",
        sourceLinks: ["https://example.com/mixed-language"]
      }
    });

    const result = await generateArticlesForSelectedItems(repository, provider, [item]);

    expect(result.generated).toBe(1);
  });

  test("falls back when generated commentary collapses into a title fragment", async () => {
    repository = await createRepository();
    const item = persist(createItem("title-fragment"));
    const provider = new RecordingProvider({
      "title-fragment": {
        articleTitle: "AI tooling moves deeper into game production",
        articleBody: "1. Studio News reports AI-assisted NPC tooling for game live operations and narrative testing.\n2. The update focuses on NPC tooling and studio workflows.\n3. Ongoing production impact should be monitored.",
        introSummary: "AI tooling moves deeper into",
        sourceLinks: ["https://example.com/title-fragment"]
      }
    });

    const result = await generateArticlesForSelectedItems(repository, provider, [item]);

    expect(result.generated).toBe(0);
    expect(result.fallback).toBe(1);
    expect(result.validationFailures[0]?.reasons).toEqual(expect.arrayContaining([
      "intro summary is empty",
      "intro summary is too similar to the title"
    ]));
  });
});

async function createRepository(): Promise<NewsRepository> {
  tempDir = await mkdtemp(join(tmpdir(), "article-generation-"));
  return openNewsRepository(join(tempDir, "news.sqlite"));
}

function persist(item: NewsItem): NewsItem {
  repository!.saveProcessedFields(item);
  return item;
}

function createItem(id: string, overrides: Partial<NewsItem> = {}): NewsItem {
  const category = overrides.category ?? "AI x Game";
  return {
    id,
    sourceName: "Studio News",
    sourceType: (overrides.sourceType as SourceType | undefined) ?? "ai_game_media",
    sourceWeight: overrides.sourceWeight ?? 80,
    sourceUrl: overrides.sourceUrl ?? `https://example.com/${id}`,
    rawContent: "Studio News reports AI-assisted NPC tooling for game live operations and narrative testing.",
    publishedAt: "2026-05-19T10:00:00.000Z",
    collectedAt: "2026-05-19T11:00:00.000Z",
    summary: "AI-assisted NPC tooling for game live operations and narrative testing.",
    keywords: ["AI", "game", "NPC", "tooling"],
    category,
    score: 90,
    newsValueScore: 90,
    duplicateOf: null,
    selected: overrides.selected ?? true,
    officialSources: overrides.officialSources ?? [`https://example.com/${id}`],
    articleTitle: "AI tooling moves deeper into game production",
    articleBody: "A game studio released AI-assisted NPC tooling for live operations and narrative testing.",
    introSummary: "AI x game production signal",
    assets: [],
    scriptSegments: [],
    ttsSegments: [],
    timeline: [],
    subtitleSrt: "",
    aiRelevanceScore: 90,
    gameRelevanceScore: 90,
    crossRelevanceScore: 90,
    aiTags: ["tooling"],
    gameTags: ["npc"],
    isTopicCandidate: true,
    exclusionReason: "",
    ...overrides
  };
}

class RecordingProvider implements AIProvider {
  readonly groups: ArticleGenerationContextGroup[] = [];

  constructor(private readonly entries: Record<string, Omit<GroupedArticleEntriesResult["entries"][number], "id">> = {}) {}

  async generateArticleEntries(groups: ArticleGenerationContextGroup[]): Promise<GroupedArticleEntriesResult> {
    this.groups.push(...groups);
    return {
      entries: groups.flatMap((group) => group.items.map((item) => {
        const defaults = {
          articleTitle: "AI NPC tooling ships for game teams",
          articleBody: "1. Studio News reports AI-assisted NPC tooling for game live operations and narrative testing.\n2. The update focuses on NPC tooling and studio workflows.\n3. Ongoing production impact should be monitored.",
          introSummary: "这波AI NPC工具已经进到实战流程，游戏研发终于不只是在看Demo了！",
          sourceLinks: [item.sourceUrl]
        };
        return { id: item.id, ...defaults, ...this.entries[item.id] };
      }))
    };
  }

  async classifyAndFilter(_item: NewsItem, _options: ClassificationOptions): Promise<ClassificationResult> {
    throw new Error("not used");
  }

  async summarize(_item: NewsItem): Promise<SummaryResult> {
    throw new Error("not used");
  }

  async extractKeywords(_item: NewsItem): Promise<KeywordsResult> {
    throw new Error("not used");
  }

  async scoreRelevance(_item: NewsItem): Promise<RelevanceScoreResult> {
    throw new Error("not used");
  }

  async generateArticleEntry(_item: NewsItem): Promise<ArticleEntryResult> {
    throw new Error("not used");
  }

  async formatMarkdown(_items: NewsItem[], _generatedAt: string): Promise<MarkdownResult> {
    throw new Error("not used");
  }

  async generateVoiceoverScript(_items: NewsItem[]): Promise<VoiceoverScriptResult> {
    throw new Error("not used");
  }
}
