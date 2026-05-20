import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { openNewsRepository } from "../src/db/newsRepository.js";
import { runWeeklyPipeline } from "../src/pipeline/weeklyPipeline.js";
import type { NewsItem } from "../src/pipeline/types.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("runWeeklyPipeline", () => {
  test("stores reports by ISO week and overwrites the same week path", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "news-weekly-pipeline-"));
    const databasePath = join(tempDir, "data", "news.sqlite");
    const config = loadConfig({
      NODE_ENV: "test",
      OUTPUT_DIR: join(tempDir, "output"),
      DATA_DIR: join(tempDir, "data"),
      DATABASE_PATH: databasePath
    });

    const repository = openNewsRepository(databasePath);
    try {
      repository.saveProcessedFields(createNewsItem({
        id: "before-week",
        articleTitle: "Before week",
        publishedAt: "2026-05-17T23:59:59.000Z",
        collectedAt: "2026-05-17T23:59:59.000Z",
        score: 99
      }));
      repository.saveProcessedFields(createNewsItem({
        id: "mock-week",
        articleTitle: "Mock week",
        publishedAt: "2026-05-20T00:00:00.000Z",
        collectedAt: "2026-05-20T00:00:00.000Z",
        score: 100,
        isMock: true
      }));
      repository.saveProcessedFields(createNewsItem({
        id: "week-start",
        articleTitle: "Week start",
        publishedAt: "2026-05-18T00:00:00.000Z",
        collectedAt: "2026-05-18T00:00:00.000Z",
        score: 90
      }));
      repository.saveProcessedFields(createNewsItem({
        id: "week-end",
        articleTitle: "Week end",
        publishedAt: "2026-05-24T23:59:59.000Z",
        collectedAt: "2026-05-24T23:59:59.000Z",
        score: 91
      }));
    } finally {
      repository.close();
    }

    await writeSelectionAuditFixture(join(config.OUTPUT_DIR, "2026-05-18"), [
      createAuditEntry("week-start", "Week start", 90),
      createAuditEntry("week-end", "Week end", 91),
      createAuditEntry("mock-week", "Mock week", 100)
    ]);

    const first = await runWeeklyPipeline(config, { date: "2026-05-20" });
    const second = await runWeeklyPipeline(config, { date: "2026-05-22" });

    expect(first.weekKey).toBe("2026-W21");
    expect(first.startDate).toBe("2026-05-18");
    expect(first.endDate).toBe("2026-05-24");
    expect(first.outputDir).toMatch(/output[\\/]weekly[\\/]2026-W21$/u);
    expect(second.outputDir).toBe(first.outputDir);
    expect(second.weeklyHtmlPath).toBe(first.weeklyHtmlPath);
    expect(existsSync(join(first.outputDir, "weekly.md"))).toBe(true);
    expect(existsSync(join(first.outputDir, "weekly.html"))).toBe(true);
    expect(first.selectedItems.map((item) => item.id)).toEqual(["week-end", "week-start"]);

    const markdown = await readFile(first.weeklyMarkdownPath, "utf8");
    expect(markdown).toContain("2026\\-W21");
    expect(markdown).toContain("Week end");
    expect(markdown).toContain("Week start");
    expect(markdown).not.toContain("Mock week");
    expect(markdown).not.toContain("Before week");
  });
});

function createNewsItem(overrides: Partial<NewsItem> & Pick<NewsItem, "id">): NewsItem {
  const base: NewsItem = {
    id: overrides.id,
    sourceUrl: `https://example.com/${overrides.id}`,
    sourceName: "Test Source",
    sourceType: "ai_game_media",
    sourceWeight: 80,
    publishedAt: "2026-05-20T00:00:00.000Z",
    collectedAt: "2026-05-20T00:00:00.000Z",
    rawContent: "AI game tooling update.",
    summary: "AI game tooling update.",
    keywords: ["AI", "game"],
    category: "AI x Game",
    score: 80,
    newsValueScore: 80,
    duplicateOf: null,
    selected: true,
    isMock: false,
    officialSources: [],
    articleTitle: "AI game tooling update",
    articleBody: "AI game tooling update.",
    introSummary: "AI game tooling update.",
    assets: [],
    scriptSegments: [],
    ttsSegments: [],
    timeline: [],
    subtitleSrt: "",
    aiRelevanceScore: 80,
    gameRelevanceScore: 80,
    crossRelevanceScore: 80,
    aiTags: ["tooling"],
    gameTags: ["production"],
    isTopicCandidate: true,
    exclusionReason: ""
  };

  return { ...base, ...overrides, id: overrides.id };
}

async function writeSelectionAuditFixture(outputDir: string, selected: ReturnType<typeof createAuditEntry>[]): Promise<void> {
  const auditDir = join(outputDir, "audit");
  await mkdir(auditDir, { recursive: true });
  await writeFile(join(auditDir, "editorial-selection-audit.json"), `${JSON.stringify({
    generatedAt: "2026-05-18T00:00:00.000Z",
    selected
  }, null, 2)}\n`, "utf8");
}

function createAuditEntry(id: string, title: string, score: number) {
  return {
    id,
    title,
    category: "AI x Game",
    sourceName: "Test Source",
    sourceUrl: `https://example.com/${id}`,
    reasons: ["selected"],
    evidence: {
      score,
      sourceWeight: 80,
      freshnessHours: 0,
      category: "AI x Game",
      sourceUrl: `https://example.com/${id}`,
      officialSources: [`https://example.com/${id}`],
      duplicateGroup: id
    }
  };
}
