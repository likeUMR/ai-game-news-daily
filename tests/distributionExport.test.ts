import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createDistributionExportPackages,
  DISTRIBUTION_PLATFORMS,
  validatePlatformMetadata,
  type PlatformMetadata
} from "../src/distribution/exportPackages.js";
import type { NewsItem } from "../src/pipeline/types.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("createDistributionExportPackages", () => {
  test("creates platform folders and metadata without credentials or upload behavior", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "news-distribution-"));
    const markdownPath = join(tempDir, "2026-05-19", "daily-report.md");
    const videoPath = join(tempDir, "2026-05-19", "daily.mp4");
    const subtitlePath = join(tempDir, "2026-05-19", "subtitles.srt");
    await mkdir(join(tempDir, "2026-05-19"), { recursive: true });
    await writeFile(markdownPath, "# Daily\n", "utf8");
    await writeFile(videoPath, "video", "utf8");
    await writeFile(subtitlePath, "subtitles", "utf8");

    const result = await createDistributionExportPackages({
      generatedAt: "2026-05-19T08:00:00.000Z",
      outputRoot: tempDir,
      items: [createItem()],
      markdownPath,
      videoPath,
      subtitlePath
    });

    expect(result.distributionDir).toBe(join(tempDir, "2026-05-19", "distribution"));
    expect(result.packages.map((item) => item.platform).sort()).toEqual([...DISTRIBUTION_PLATFORMS].sort());
    expect(existsSync(result.manifestPath)).toBe(true);

    for (const platform of DISTRIBUTION_PLATFORMS) {
      const metadataPath = join(result.distributionDir, platform, "metadata.json");
      expect(existsSync(metadataPath)).toBe(true);
      const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as PlatformMetadata;
      expect(metadata.title).toContain("2026-05-19 AI + Game News Daily");
      expect(metadata.description).toContain("Prepared locally without credentials or platform upload calls.");
      expect(metadata.tags).toContain("AI");
      if (metadata.lengthLimits.titleCharacters) {
        expect([...metadata.title].length).toBeLessThanOrEqual(metadata.lengthLimits.titleCharacters);
      }
      expect(metadata.sourceLinks).toEqual(expect.arrayContaining([
        { label: "GameLook", url: "https://example.com/gamelook-ai-tools" }
      ]));
      expect(metadata.upload).toEqual({
        preparedOnly: true,
        credentialFree: true,
        requiresManualPublishing: true
      });
    }

    const bilibili = JSON.parse(await readFile(join(result.distributionDir, "bilibili", "metadata.json"), "utf8")) as PlatformMetadata;
    const youtube = JSON.parse(await readFile(join(result.distributionDir, "youtube", "metadata.json"), "utf8")) as PlatformMetadata;
    const wechat = JSON.parse(await readFile(join(result.distributionDir, "wechat", "metadata.json"), "utf8")) as PlatformMetadata;
    const zhihu = JSON.parse(await readFile(join(result.distributionDir, "zhihu", "metadata.json"), "utf8")) as PlatformMetadata;

    expect(bilibili.videoPath).toBe(videoPath);
    expect(bilibili.subtitlePath).toBe(subtitlePath);
    expect(bilibili.lengthLimits.descriptionCharacters).toBe(2000);
    expect(youtube.videoPath).toBe(videoPath);
    expect(youtube.subtitlePath).toBe(subtitlePath);
    expect(youtube.lengthLimits.descriptionCharacters).toBe(5000);
    expect(wechat.contentPath).toBe(markdownPath);
    expect(wechat.videoPath).toBeNull();
    expect(zhihu.contentPath).toBe(markdownPath);
  });

  test("validates Bilibili and YouTube description limits", () => {
    expect(() => validatePlatformMetadata({
      platform: "bilibili",
      title: "valid title",
      description: "a".repeat(2001),
      lengthLimits: { descriptionCharacters: 2000 }
    })).toThrow(/bilibili description is 2001 characters; limit is 2000/);

    expect(() => validatePlatformMetadata({
      platform: "youtube",
      title: "valid title",
      description: "a".repeat(5001),
      lengthLimits: { descriptionCharacters: 5000 }
    })).toThrow(/youtube description is 5001 characters; limit is 5000/);

    expect(() => validatePlatformMetadata({
      platform: "youtube",
      title: "valid title",
      description: "a".repeat(5000),
      lengthLimits: { descriptionCharacters: 5000 }
    })).not.toThrow();
  });

  test("clamps platform titles before writing metadata", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "news-distribution-title-"));
    const item = createItem();
    item.articleTitle = "A".repeat(180);

    const result = await createDistributionExportPackages({
      generatedAt: "2026-05-19T08:00:00.000Z",
      outputRoot: tempDir,
      items: [item],
      markdownPath: join(tempDir, "daily.md")
    });

    const youtube = JSON.parse(await readFile(join(result.distributionDir, "youtube", "metadata.json"), "utf8")) as PlatformMetadata;
    expect([...youtube.title]).toHaveLength(100);
    expect(youtube.title.endsWith("...")).toBe(true);
  });

  test("clamps platform descriptions before writing metadata", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "news-distribution-description-"));
    const items = Array.from({ length: 80 }, (_, index) => {
      const item = createItem();
      item.id = `item-${index}`;
      item.sourceUrl = `https://example.com/source-${index}`;
      item.articleTitle = `AI game production story ${index}`;
      item.introSummary = "Detailed generated summary ".repeat(8);
      return item;
    });

    const result = await createDistributionExportPackages({
      generatedAt: "2026-05-19T08:00:00.000Z",
      outputRoot: tempDir,
      items,
      markdownPath: join(tempDir, "daily.md")
    });

    const bilibili = JSON.parse(await readFile(join(result.distributionDir, "bilibili", "metadata.json"), "utf8")) as PlatformMetadata;
    expect([...bilibili.description].length).toBeLessThanOrEqual(2000);
    expect(bilibili.description.endsWith("...")).toBe(true);
  });
});

function createItem(): NewsItem {
  return {
    id: "mock-gamelook-ai-tools",
    sourceUrl: "https://example.com/gamelook-ai-tools",
    sourceName: "GameLook",
    sourceType: "ai_game_media",
    sourceWeight: 80,
    publishedAt: "2026-05-19T07:00:00.000Z",
    collectedAt: "2026-05-19T08:00:00.000Z",
    rawContent: "raw",
    summary: "A studio shipped AI tooling for game production.",
    keywords: ["AI tools", "game production"],
    category: "AI x Game",
    score: 90,
    newsValueScore: 88,
    duplicateOf: null,
    selected: true,
    officialSources: ["https://example.com/official-ai-tools"],
    articleTitle: "AI tooling reaches game teams",
    articleBody: "Body",
    introSummary: "AI tooling is moving into game production.",
    assets: [],
    scriptSegments: [],
    ttsSegments: [],
    timeline: [],
    subtitleSrt: "",
    aiRelevanceScore: 95,
    gameRelevanceScore: 92,
    crossRelevanceScore: 91,
    aiTags: ["AI"],
    gameTags: ["Games"],
    isTopicCandidate: true,
    exclusionReason: ""
  };
}
