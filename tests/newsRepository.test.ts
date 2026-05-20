import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  canonicalizeUrl,
  hashContent,
  openNewsRepository,
  type NewsRepository
} from "../src/db/newsRepository.js";
import type { NewsItem } from "../src/pipeline/types.js";

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

describe("NewsRepository", () => {
  test("initializes idempotently and upserts sources", async () => {
    repository = await createRepository();
    repository.close();
    repository = openNewsRepository(join(tempDir!, "news.sqlite"));

    const first = repository.upsertSource({
      name: "GameLook",
      type: "ai_game_media",
      weight: 70,
      url: "https://example.com"
    });
    const second = repository.upsertSource({
      name: "GameLook",
      type: "official",
      weight: 95,
      url: "https://example.com/official"
    });

    expect(second.id).toBe(first.id);
    expect(second.type).toBe("official");
    expect(second.weight).toBe(95);
    expect(second.url).toBe("https://example.com/official");
  });

  test("inserts raw items and finds existing items by canonical URL or content hash", async () => {
    repository = await createRepository();
    const source = repository.upsertSource({ name: "AI Wire", type: "ai_media", weight: 80 });
    const raw = repository.insertRawItem({
      id: "raw-1",
      sourceId: source.id,
      sourceUrl: "https://example.com/story?utm_source=feed#comments",
      rawContent: "  AI tools changed game testing. ",
      publishedAt: "2026-05-19T00:00:00.000Z",
      collectedAt: "2026-05-19T00:01:00.000Z",
      metadata: { collector: "test" }
    });

    expect(raw.canonicalUrl).toBe("https://example.com/story");
    expect(raw.contentHash).toBe(hashContent("AI tools changed game testing."));
    expect(raw.metadata).toEqual({ collector: "test" });

    const byUrl = repository.findByCanonicalUrlOrContentHash(
      canonicalizeUrl("https://example.com/story"),
      "missing"
    );
    const byContent = repository.findByCanonicalUrlOrContentHash(
      "https://example.com/other",
      hashContent("AI tools changed game testing.")
    );

    expect(byUrl?.id).toBe("raw-1");
    expect(byContent?.id).toBe("raw-1");
  });

  test("round trips processed item JSON fields and selects candidates", async () => {
    repository = await createRepository();
    const source = repository.upsertSource({ name: "Cross Beat", type: "ai_game_media", weight: 90 });
    const raw = repository.insertRawItem({
      sourceId: source.id,
      sourceUrl: "https://example.com/candidate",
      rawContent: "AI NPC tooling ships for game teams.",
      publishedAt: "2026-05-19T00:00:00.000Z",
      collectedAt: "2026-05-19T00:02:00.000Z"
    });
    const item = createNewsItem({
      id: "processed-1",
      sourceUrl: raw.sourceUrl,
      sourceName: source.name,
      sourceType: source.type,
      sourceWeight: source.weight,
      publishedAt: raw.publishedAt,
      collectedAt: raw.collectedAt,
      rawContent: raw.rawContent,
      selected: true,
      isTopicCandidate: true,
      score: 88,
      crossRelevanceScore: 91,
      keywords: ["AI", "NPC"],
      officialSources: ["https://example.com/official"],
      assets: ["asset://hero"],
      scriptSegments: ["intro", "detail"],
      ttsSegments: [{ text: "Intro", durationMs: 1200, audioPath: "tts/intro.wav" }],
      timeline: [{ itemId: "processed-1", startMs: 0, endMs: 1200, title: "Intro" }],
      aiTags: ["agent"],
      gameTags: ["live-ops"]
    });

    const saved = repository.saveProcessedFields({ ...item, rawItemId: raw.id });
    const reloaded = repository.getProcessedItem("processed-1");
    const candidates = repository.selectCandidates(5, 80);
    const dedupeItems = repository.listRecentItemsForDedupe(10);

    expect(saved.keywords).toEqual(["AI", "NPC"]);
    expect(reloaded?.officialSources).toEqual(["https://example.com/official"]);
    expect(reloaded?.ttsSegments).toEqual([{ text: "Intro", durationMs: 1200, audioPath: "tts/intro.wav" }]);
    expect(reloaded?.timeline).toEqual([{ itemId: "processed-1", startMs: 0, endMs: 1200, title: "Intro" }]);
    expect(reloaded?.aiTags).toEqual(["agent"]);
    expect(reloaded?.gameTags).toEqual(["live-ops"]);
    expect(candidates.map((candidate) => candidate.id)).toEqual(["processed-1"]);
    expect(dedupeItems[0]).toMatchObject({
      id: "processed-1",
      rawItemId: raw.id,
      canonicalUrl: "https://example.com/candidate"
    });
  });

  test("saves generated outputs for pipeline runs", async () => {
    repository = await createRepository();
    const startedAt = "2026-05-19T00:00:00.000Z";
    const run = repository.savePipelineRun({
      id: "run-1",
      status: "succeeded",
      startedAt,
      completedAt: "2026-05-19T00:03:00.000Z",
      config: { mock: true },
      result: { selected: 1 }
    });
    const output = repository.saveGeneratedOutput({
      runId: run.id,
      outputType: "markdown",
      outputPath: "output/daily-report.md",
      content: "# Daily",
      metadata: { format: "md" }
    });

    expect(run.config).toEqual({ mock: true });
    expect(run.result).toEqual({ selected: 1 });
    expect(output.runId).toBe("run-1");
    expect(output.outputType).toBe("markdown");
    expect(output.metadata).toEqual({ format: "md" });
  });
});

async function createRepository(): Promise<NewsRepository> {
  tempDir = await mkdtemp(join(tmpdir(), "news-repository-"));
  return openNewsRepository(join(tempDir, "news.sqlite"));
}

function createNewsItem(overrides: Partial<NewsItem> & Pick<NewsItem, "id">): NewsItem {
  const now = "2026-05-19T00:00:00.000Z";

  const base: NewsItem = {
    id: overrides.id,
    sourceUrl: "",
    sourceName: "",
    sourceType: "community",
    sourceWeight: 0,
    publishedAt: now,
    collectedAt: now,
    rawContent: "",
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

  return { ...base, ...overrides, id: overrides.id };
}
