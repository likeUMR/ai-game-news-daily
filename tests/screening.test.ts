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
import { applySourceWeight, screenPendingRawItems } from "../src/pipeline/screening.js";
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

describe("screenPendingRawItems", () => {
  test("selects candidates only when weighted cross relevance and news value pass thresholds", async () => {
    repository = await createRepository();
    insertRawItem("candidate", {
      sourceWeight: 90,
      rawContent: "A studio shipped AI NPC tooling for game live operations with named production rollout details."
    });

    const result = await screenPendingRawItems(repository, new FixedProvider({
      newsValueScore: 55,
      aiRelevanceScore: 86,
      gameRelevanceScore: 84,
      crossRelevanceScore: 55,
      isTopicCandidate: true,
      exclusionReasons: [],
      aiTags: ["tooling"],
      gameTags: ["npc"]
    }), {
      minNewsValueScore: 60,
      minCrossRelevanceScore: 60
    });
    const processed = repository.getProcessedItem("candidate");

    expect(applySourceWeight(55, 90)).toBe(65);
    expect(result).toMatchObject({ processed: 1, candidates: 1, excluded: 0, errors: 0 });
    expect(processed?.isTopicCandidate).toBe(true);
    expect(processed?.selected).toBe(true);
    expect(processed?.summary).toContain("summary");
    expect(processed?.keywords).toEqual(["AI", "game"]);
    expect(processed?.aiTags).toEqual(["tooling"]);
    expect(processed?.gameTags).toEqual(["npc"]);
    expect(repository.listProcessingAuditLogs("candidate")[0]?.status).toBe("processed");
  });

  test("records deterministic exclusion categories", async () => {
    repository = await createRepository();
    insertRawItem("non-ai", {
      rawContent: "A game publisher announced a non-AI seasonal patch and esports event for catalog players.",
      sourceWeight: 80
    });
    insertRawItem("tutorial", {
      rawContent: "Tutorial: how to use AI prompts for game art mood boards without any new product release.",
      sourceWeight: 80
    });
    insertRawItem("gossip", {
      rawContent: "Celebrity gossip and cosplay rumor coverage around a game trailer reaction using AI memes.",
      sourceWeight: 80
    });
    insertRawItem("repost", {
      rawContent: "Repost: AI game funding mention.",
      sourceWeight: 80
    });

    const provider = new MapProvider({
      "non-ai": classification({ aiRelevanceScore: 10, gameRelevanceScore: 88, crossRelevanceScore: 35, newsValueScore: 80 }),
      tutorial: classification({ aiRelevanceScore: 80, gameRelevanceScore: 80, crossRelevanceScore: 75, newsValueScore: 50 }),
      gossip: classification({ aiRelevanceScore: 80, gameRelevanceScore: 80, crossRelevanceScore: 75, newsValueScore: 80 }),
      repost: classification({ aiRelevanceScore: 80, gameRelevanceScore: 80, crossRelevanceScore: 75, newsValueScore: 80 })
    });

    const result = await screenPendingRawItems(repository, provider, {
      minNewsValueScore: 60,
      minCrossRelevanceScore: 60
    });

    expect(result).toMatchObject({ processed: 4, candidates: 0, excluded: 4, errors: 0 });
    expect(repository.getProcessedItem("non-ai")?.exclusionReason).toContain("non-ai game news");
    expect(repository.getProcessedItem("tutorial")?.exclusionReason).toContain("generic tutorial");
    expect(repository.getProcessedItem("gossip")?.exclusionReason).toContain("pure entertainment gossip");
    expect(repository.getProcessedItem("repost")?.exclusionReason).toContain("low-information repost");
  });

  test("source weight can change threshold outcome deterministically", async () => {
    repository = await createRepository();
    const rawContent = "A studio shipped AI NPC tooling for game live operations with named production rollout details.";
    insertRawItem("low-source", { sourceWeight: 50, rawContent });
    insertRawItem("high-source", { sourceWeight: 90, rawContent });

    const provider = new FixedProvider(classification({
      newsValueScore: 55,
      aiRelevanceScore: 90,
      gameRelevanceScore: 90,
      crossRelevanceScore: 55
    }));

    const result = await screenPendingRawItems(repository, provider, {
      minNewsValueScore: 60,
      minCrossRelevanceScore: 60
    });

    expect(result).toMatchObject({ processed: 2, candidates: 1, excluded: 1, errors: 0 });
    expect(repository.getProcessedItem("low-source")?.isTopicCandidate).toBe(false);
    expect(repository.getProcessedItem("low-source")?.exclusionReason).toContain("cross relevance below threshold");
    expect(repository.getProcessedItem("high-source")?.isTopicCandidate).toBe(true);
  });

  test("processing errors are audited without stopping later items", async () => {
    repository = await createRepository();
    insertRawItem("broken", {
      rawContent: "A studio shipped AI NPC tooling for game live operations with named production rollout details."
    });
    insertRawItem("ok", {
      rawContent: "Another studio shipped AI NPC tooling for game live operations with named production rollout details."
    });

    const result = await screenPendingRawItems(repository, new ThrowingProvider("broken"), {
      minNewsValueScore: 60,
      minCrossRelevanceScore: 60
    });

    expect(result).toMatchObject({ processed: 1, candidates: 1, excluded: 0, errors: 1 });
    expect(repository.getProcessedItem("broken")).toBeNull();
    expect(repository.getProcessedItem("ok")?.isTopicCandidate).toBe(true);
    expect(repository.listProcessingAuditLogs("broken")[0]).toMatchObject({
      status: "error",
      message: "synthetic provider failure"
    });
  });
});

async function createRepository(): Promise<NewsRepository> {
  tempDir = await mkdtemp(join(tmpdir(), "screening-"));
  return openNewsRepository(join(tempDir, "news.sqlite"));
}

function insertRawItem(
  id: string,
  overrides: {
    sourceWeight?: number;
    sourceType?: SourceType;
    rawContent: string;
  }
): void {
  const source = repository!.upsertSource({
    name: `Source ${id}`,
    type: overrides.sourceType ?? "ai_game_media",
    weight: overrides.sourceWeight ?? 90
  });
  repository!.insertRawItem({
    id,
    sourceId: source.id,
    sourceUrl: `https://example.com/${id}`,
    rawContent: overrides.rawContent,
    publishedAt: "2026-05-19T00:00:00.000Z",
    collectedAt: "2026-05-19T00:00:00.000Z",
    metadata: { title: id }
  });
}

function classification(overrides: Partial<ClassificationResult>): ClassificationResult {
  return {
    newsValueScore: 85,
    aiRelevanceScore: 90,
    gameRelevanceScore: 88,
    crossRelevanceScore: 85,
    isTopicCandidate: true,
    exclusionReasons: [],
    aiTags: ["tooling"],
    gameTags: ["npc"],
    ...overrides
  };
}

class FixedProvider implements AIProvider {
  constructor(private readonly result: ClassificationResult) {}

  async classifyAndFilter(_item: NewsItem, _options: ClassificationOptions): Promise<ClassificationResult> {
    return this.result;
  }

  async summarize(item: NewsItem): Promise<SummaryResult> {
    return { summary: `summary for ${item.id}`, introSummary: `intro for ${item.id}` };
  }

  async extractKeywords(_item: NewsItem): Promise<KeywordsResult> {
    return { keywords: ["AI", "game"] };
  }

  async scoreRelevance(_item: NewsItem): Promise<RelevanceScoreResult> {
    return {
      aiRelevanceScore: this.result.aiRelevanceScore,
      gameRelevanceScore: this.result.gameRelevanceScore,
      crossRelevanceScore: this.result.crossRelevanceScore
    };
  }

  async generateArticleEntry(item: NewsItem): Promise<ArticleEntryResult> {
    return {
      title: `title for ${item.id}`,
      body: `body for ${item.id}`,
      category: "AI x Game",
      officialSources: [item.sourceUrl]
    };
  }

  async generateArticleEntries(groups: ArticleGenerationContextGroup[]): Promise<GroupedArticleEntriesResult> {
    return {
      entries: groups.flatMap((group) => group.items.map((item) => ({
        id: item.id,
        articleTitle: `title for ${item.id}`,
        articleBody: `body for ${item.id}`,
        introSummary: `intro for ${item.id}`,
        sourceLinks: [item.sourceUrl]
      })))
    };
  }

  async formatMarkdown(_items: NewsItem[], _generatedAt: string): Promise<MarkdownResult> {
    return { markdown: "# Daily" };
  }

  async generateVoiceoverScript(_items: NewsItem[]): Promise<VoiceoverScriptResult> {
    return { segments: ["segment"] };
  }
}

class MapProvider extends FixedProvider {
  constructor(private readonly results: Record<string, ClassificationResult>) {
    super(classification({}));
  }

  override async classifyAndFilter(item: NewsItem, _options: ClassificationOptions): Promise<ClassificationResult> {
    return this.results[item.id] ?? classification({});
  }
}

class ThrowingProvider extends FixedProvider {
  constructor(private readonly failingId: string) {
    super(classification({}));
  }

  override async classifyAndFilter(item: NewsItem, options: ClassificationOptions): Promise<ClassificationResult> {
    if (item.id === this.failingId) {
      throw new Error("synthetic provider failure");
    }
    return super.classifyAndFilter(item, options);
  }
}
