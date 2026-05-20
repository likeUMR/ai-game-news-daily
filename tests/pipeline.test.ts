import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { DISTRIBUTION_PLATFORMS, type PlatformMetadata } from "../src/distribution/exportPackages.js";
import { openNewsRepository } from "../src/db/newsRepository.js";
import { runPipeline } from "../src/pipeline/runPipeline.js";
import { selectAndVerifyItems } from "../src/pipeline/selection.js";
import type { NewsItem, PipelineResult } from "../src/pipeline/types.js";
import { renderDailyMarkdown } from "../src/render/markdownRenderer.js";

const fixedDate = "2026-05-19";
const fixedGeneratedAt = `${fixedDate}T00:00:00.000Z`;
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("mock daily pipeline quality gates", () => {
  test("creates all expected artifacts, records outputs, and preserves source-backed claims", async () => {
    const run = await runMockDailyPipeline();
    const outputDir = join(run.tempDir, "output", fixedDate);
    const dailyMarkdownPath = join(outputDir, "daily.md");
    const zhihuMarkdownPath = join(outputDir, "zhihu.md");
    const wechatHtmlPath = join(outputDir, "wechat.html");
    const subtitlePath = join(outputDir, "subtitles.srt");

    expect(run.result.generatedAt).toBe(fixedGeneratedAt);
    expect(run.result.selectedItems.map((item) => item.id)).toEqual(["mock-pixel2play-release"]);
    expect(run.result.enrichedItems.map((item) => item.id)).toEqual([
      "mock-pixel2play-release",
      "mock-sparse-npc-tooling",
      "mock-general-game-sale"
    ]);

    for (const path of [
      run.result.markdownPath,
      dailyMarkdownPath,
      zhihuMarkdownPath,
      wechatHtmlPath,
      run.result.auditPath,
      subtitlePath,
      run.result.videoPlanPath,
      run.result.videoPath,
      run.result.videoCompositionAuditPath,
      run.result.distributionManifestPath,
      run.result.runPath
    ]) {
      expect(path && existsSync(path)).toBe(true);
    }

    const daily = await readFile(dailyMarkdownPath, "utf8");
    const zhihu = await readFile(zhihuMarkdownPath, "utf8");
    const wechat = await readFile(wechatHtmlPath, "utf8");
    const audit = JSON.parse(await readFile(run.result.auditPath, "utf8")) as {
      thresholds: Record<string, unknown>;
      selected: Array<{ id: string; evidence: { sourceUrl: string; officialSources: string[] } }>;
      rejected: unknown[];
      duplicate: unknown[];
      failedVerification: unknown[];
    };
    const srt = await readFile(subtitlePath, "utf8");
    const manifest = JSON.parse(await readFile(run.result.distributionManifestPath!, "utf8")) as {
      preparedOnly: boolean;
      credentialFree: boolean;
      packages: Array<{ platform: string; metadataPath: string }>;
    };
    const runArtifact = JSON.parse(await readFile(run.result.runPath, "utf8")) as PipelineResult & {
      pipelineRun: { artifactPaths: Record<string, string> };
    };

    expect(daily).toContain("# 智游镜 \\| 每日AI游戏新闻速递 20260519");
    expect(daily).toContain("## Table of Contents");
    expect(daily).toContain("Pixel2Play");
    expect(daily).toContain("Sources:");
    expect(daily).toContain("https://example.com/pixel2play-release");
    expect(zhihu).toContain("# 智游镜 \\| 每日AI游戏新闻速递 20260519");
    expect(zhihu).toContain("Pixel2Play");
    expect(zhihu).toContain("https://example.com/pixel2play-release");
    expect(wechat).toContain("<!doctype html>");
    expect(wechat).toContain("<section");
    expect(wechat).toContain("href=\"https://example.com/pixel2play-release\"");

    expect(audit.thresholds.dailyItemCount).toBe(5);
    expect(audit.selected).toHaveLength(1);
    expect(audit.rejected.length + audit.failedVerification.length).toBe(2);
    expect(audit.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mock-sparse-npc-tooling" })
    ]));
    expect(audit.duplicate).toHaveLength(0);
    expect(audit.selected[0]).toMatchObject({
      id: "mock-pixel2play-release",
      evidence: {
        sourceUrl: "https://example.com/pixel2play-release",
        officialSources: ["https://example.com/pixel2play-release"]
      }
    });

    expect(srt).toMatch(/^1\n00:00:00,000 --> 00:00:\d{2},\d{3}\n.+/u);
    expect(manifest.preparedOnly).toBe(true);
    expect(manifest.credentialFree).toBe(true);
    expect(manifest.packages.map((pkg) => pkg.platform).sort()).toEqual([...DISTRIBUTION_PLATFORMS].sort());

    for (const platform of DISTRIBUTION_PLATFORMS) {
      const metadata = JSON.parse(await readFile(join(run.result.distributionDir!, platform, "metadata.json"), "utf8")) as PlatformMetadata;
      expect(metadata.platform).toBe(platform);
      expect(metadata.title).toContain(`${fixedDate} AI + Game News Daily`);
      expect(metadata.sourceLinks).toEqual(expect.arrayContaining([
        { label: "智游镜 Testground", url: "https://example.com/pixel2play-release" }
      ]));
      expect(metadata.upload).toEqual({
        preparedOnly: true,
        credentialFree: true,
        requiresManualPublishing: true
      });
      expect(metadata.tags).toEqual(expect.arrayContaining(["AI", "Game", "News"]));
    }

    expect(runArtifact.pipelineRun.artifactPaths).toMatchObject({
      text: run.result.markdownPath,
      dailyMarkdown: dailyMarkdownPath,
      zhihuMarkdown: zhihuMarkdownPath,
      wechatHtml: wechatHtmlPath,
      audit: run.result.auditPath,
      subtitles: subtitlePath,
      distributionManifest: run.result.distributionManifestPath
    });

    const selectedIds = new Set(run.result.selectedItems.map((item) => item.id));
    for (const duplicate of run.result.enrichedItems.filter((item) => item.duplicateOf !== null)) {
      expect(selectedIds.has(duplicate.id)).toBe(false);
      expect(selectedIds.has(duplicate.duplicateOf!)).toBe(true);
    }
    for (const item of run.result.selectedItems) {
      expect(sourceLinks(item).length).toBeGreaterThan(0);
      expectGeneratedClaimsToTrace(item);
    }

    const repository = openNewsRepository(run.databasePath);
    try {
      const outputs = repository.listGeneratedOutputs(run.result.runId);
      expect(outputs.map((output) => output.outputType).sort()).toEqual([
        "distribution_manifest",
        "html_wechat",
        "markdown_daily",
        "markdown_zhihu",
        "subtitles_srt",
        "video_daily"
      ]);
      expect(outputs.every((output) => output.runId === run.result.runId)).toBe(true);
      expect(outputs.every((output) => output.outputPath && existsSync(output.outputPath))).toBe(true);
      expect(outputs.find((output) => output.outputType === "video_daily")?.metadata).toMatchObject({
        format: "mp4",
        mode: "mock",
        subtitlePath
      });
    } finally {
      repository.close();
    }
  });

  test("is deterministic across repeated fixed-date mock runs", async () => {
    const first = await runMockDailyPipeline();
    const second = await runMockDailyPipeline();

    expect(await stableArtifacts(first.result, first.databasePath)).toEqual(await stableArtifacts(second.result, second.databasePath));
  });

  test("excludes duplicate group followers from the final report", () => {
    const canonical = createSelectedItem("canonical", {
      sourceUrl: "https://media.example.com/story",
      officialSources: []
    });
    const duplicate = createSelectedItem("official-duplicate", {
      sourceType: "official",
      sourceUrl: "https://studio.example.com/story",
      duplicateOf: "canonical",
      officialSources: ["https://studio.example.com/press/story"]
    });

    const selection = selectAndVerifyItems([canonical, duplicate], {
      generatedAt: fixedGeneratedAt,
      dailyItemCount: 2,
      categoryCounts: { "AI x Game": 2 },
      lowTrustSourceWeight: 40,
      lowTrustHighScore: 85,
      freshnessHours: 72
    });
    const finalItems = selection.items.filter((item) => item.selected);
    const report = renderDailyMarkdown(finalItems, fixedGeneratedAt);

    expect(finalItems.map((item) => item.id)).toEqual(["canonical"]);
    expect(report).toContain("canonical");
    expect(report).not.toContain("official-duplicate");
    expect(selection.audit.duplicate.map((entry) => entry.id)).toEqual(["official-duplicate"]);
  });
});

async function runMockDailyPipeline(): Promise<{ tempDir: string; databasePath: string; result: PipelineResult }> {
  const tempDir = await mkdtemp(join(tmpdir(), "news-daily-quality-"));
  tempDirs.push(tempDir);
  const databasePath = join(tempDir, "data", "news.sqlite");
  const result = await runPipeline(loadConfig({
    NODE_ENV: "test",
    MOCK_MODE: "true",
    OUTPUT_DIR: join(tempDir, "output"),
    DATA_DIR: join(tempDir, "data"),
    DATABASE_PATH: databasePath,
    MIN_CROSS_RELEVANCE_SCORE: "60"
  }), { date: fixedDate });

  return { tempDir, databasePath, result };
}

async function stableArtifacts(result: PipelineResult, databasePath: string): Promise<Record<string, unknown>> {
  const outputDir = dirname(result.markdownPath);
  const read = async (path: string) => normalizePaths(await readFile(path, "utf8"));
  const manifest = JSON.parse(await readFile(result.distributionManifestPath!, "utf8")) as {
    packages: Array<{ platform: string; metadataPath: string }>;
  };
  const generatedOutputs = (() => {
    const repository = openNewsRepository(databasePath);
    try {
      return repository.listGeneratedOutputs(result.runId).map((output) => ({
        outputType: output.outputType,
        outputPathName: output.outputPath ? basename(output.outputPath) : null,
        metadata: normalizeOutputMetadata(output.metadata)
      })).sort((left, right) => left.outputType.localeCompare(right.outputType));
    } finally {
      repository.close();
    }
  })();

  return {
    selectedIds: result.selectedItems.map((item) => item.id),
    enriched: result.enrichedItems.map((item) => ({
      id: item.id,
      selected: item.selected,
      duplicateOf: item.duplicateOf,
      sourceLinks: sourceLinks(item),
      articleTitle: item.articleTitle,
      introSummary: item.introSummary,
      category: item.category,
      score: item.score
    })),
    daily: await read(join(outputDir, "daily.md")),
    zhihu: await read(join(outputDir, "zhihu.md")),
    wechat: await read(join(outputDir, "wechat.html")),
    audit: normalizeAudit(JSON.parse(await readFile(result.auditPath, "utf8")) as Record<string, unknown>),
    subtitles: await read(join(outputDir, "subtitles.srt")),
    distribution: {
      platforms: manifest.packages.map((pkg) => pkg.platform).sort(),
      metadata: await Promise.all(DISTRIBUTION_PLATFORMS.map(async (platform) => {
        const metadata = JSON.parse(await readFile(join(result.distributionDir!, platform, "metadata.json"), "utf8")) as PlatformMetadata;
        return normalizePlatformMetadata(metadata);
      }))
    },
    generatedOutputs
  };
}

function sourceLinks(item: NewsItem): string[] {
  return [item.sourceUrl, ...item.officialSources].filter((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  });
}

function expectGeneratedClaimsToTrace(item: NewsItem): void {
  const evidence = tokenize([
    item.sourceName,
    item.sourceUrl,
    item.rawContent,
    item.summary,
    item.category,
    item.keywords.join(" "),
    item.aiTags.join(" "),
    item.gameTags.join(" "),
    item.officialSources.join(" ")
  ].join(" "));
  const fallbackText = new Set([
    "Open-P2P团队发布实时通用游戏AI Pixel2Play，以游戏画面和文本指令作为输入",
    "AI x game production signal",
    "1. Open-P2P团队发布实时通用游戏AI Pixel2Play，以游戏画面和文本指令作为输入，输出操作信号。 训练数据覆盖40多款游戏和8300小时以上游玩记录，支持零样本操作Roblox和Steam游戏。 模型采用轻量级Transformer与action-decoder架构，最大模型推理速度约40Hz。\n2. 这条动态来自智游镜 Testground，变化重点集中在AI、游戏、AI x 游戏、tooling、workflow、development、operations相关流程。\n3. 后续可继续观察它会先落到研发提效、内容生产，还是长期运营环节。",
    "AI工具已经摸到游戏研发和运营现场，这波不是概念秀而是工作流改造！",
    "This item is retained in raw collection but excluded from the daily topic candidates."
  ]);

  for (const [field, value] of Object.entries({
    articleTitle: item.articleTitle,
    articleBody: item.articleBody,
    introSummary: item.introSummary,
    summary: item.summary
  })) {
    const claims = tokenList(value);
    const traced = claims.filter((token) => evidence.has(token));
    const isTraced = fallbackText.has(value) || traced.length / Math.max(claims.length, 1) >= 0.5;
    expect(isTraced, `${field} should trace to source context or approved fallback text`).toBe(true);
  }
}

function tokenize(value: string): Set<string> {
  return new Set(tokenList(value));
}

function tokenList(value: string): string[] {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((token) => token.replace(/(?:ing|ed|es|s)$/u, ""))
    .filter((token) => token.length > 3 && !["into", "with", "this", "that", "source"].includes(token));
}

function normalizePaths(value: string): string {
  return value.replace(/[A-Z]:\\[^"\n]+|\/tmp\/[^"\n]+/gu, "<path>");
}

function normalizeAudit(audit: Record<string, unknown>): Record<string, unknown> {
  return {
    generatedAt: audit.generatedAt,
    selected: audit.selected,
    rejected: audit.rejected,
    duplicate: audit.duplicate,
    failedVerification: audit.failedVerification
  };
}

function normalizePlatformMetadata(metadata: PlatformMetadata): Record<string, unknown> {
  return {
    platform: metadata.platform,
    title: metadata.title,
    description: normalizePaths(metadata.description),
    tags: metadata.tags,
    sourceLinks: metadata.sourceLinks,
    subtitlePathName: metadata.subtitlePath ? basename(metadata.subtitlePath) : null,
    videoPathName: metadata.videoPath ? basename(metadata.videoPath) : null,
    contentPathName: metadata.contentPath ? basename(metadata.contentPath) : null,
    lengthLimits: metadata.lengthLimits,
    upload: metadata.upload
  };
}

function normalizeOutputMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    key,
    typeof value === "string" ? normalizePaths(value) : value
  ]));
}

function createSelectedItem(id: string, overrides: Partial<NewsItem> = {}): NewsItem {
  const sourceUrl = overrides.sourceUrl ?? `https://example.com/${id}`;
  return {
    id,
    sourceName: id,
    sourceType: overrides.sourceType ?? "ai_game_media",
    sourceWeight: overrides.sourceWeight ?? 80,
    sourceUrl,
    rawContent: `${id} A game studio released AI-assisted NPC tooling for live operations and narrative testing.`,
    publishedAt: "2026-05-19T00:00:00.000Z",
    collectedAt: "2026-05-19T00:00:00.000Z",
    summary: `${id} AI-assisted NPC tooling for game live operations and narrative testing.`,
    keywords: ["AI", "game", "NPC", id],
    category: "AI x Game",
    score: overrides.score ?? 90,
    newsValueScore: 90,
    duplicateOf: overrides.duplicateOf ?? null,
    selected: false,
    officialSources: overrides.officialSources ?? [sourceUrl],
    articleTitle: `${id} AI tooling moves deeper into game production`,
    articleBody: `${id} A game studio released AI-assisted NPC tooling for live operations and narrative testing.`,
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
    exclusionReason: ""
  };
}
