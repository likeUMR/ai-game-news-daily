import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAIProvider } from "../ai/providerFactory.js";
import type { AppConfig } from "../config/env.js";
import { collectMockNews } from "../collectors/mockCollector.js";
import { openNewsRepository, type NewsRepository } from "../db/newsRepository.js";
import { enrichWithMockAi } from "../ai/mockAi.js";
import {
  renderDailyMarkdown,
  renderWeChatHtml,
  renderZhihuMarkdown
} from "../render/markdownRenderer.js";
import { generateArticlesForSelectedItems } from "./articleGeneration.js";
import { markDuplicateNewsItems } from "./dedupe.js";
import { parseCategoryCounts, selectAndVerifyItems } from "./selection.js";
import type { NewsItem } from "./types.js";

export interface TextRenderingResult {
  generatedAt: string;
  runId: string;
  selectedItems: NewsItem[];
  outputDir: string;
  dailyMarkdownPath: string;
  zhihuMarkdownPath: string;
  wechatHtmlPath: string;
}

export interface TextRenderingOptions {
  date?: string;
}

export async function runTextRendering(config: AppConfig, options: TextRenderingOptions = {}): Promise<TextRenderingResult> {
  const generatedAt = normalizeGeneratedAt(options.date);
  const date = generatedAt.slice(0, 10);
  const outputDir = join(config.OUTPUT_DIR, date);

  await mkdir(outputDir, { recursive: true });
  await mkdir(config.DATA_DIR, { recursive: true });

  const repository = openNewsRepository(config.DATABASE_PATH);
  try {
    const selectedItems = await loadSelectedItems(repository, config, generatedAt);
    const articleGenerationResult = await generateArticlesForSelectedItems(repository, createAIProvider(config), selectedItems);
    const finalItems = articleGenerationResult.items.filter((item) => item.selected);
    const dailyMarkdown = renderDailyMarkdown(finalItems, generatedAt);
    const zhihuMarkdown = renderZhihuMarkdown(finalItems, generatedAt);
    const wechatHtml = renderWeChatHtml(finalItems, generatedAt);

    const dailyMarkdownPath = join(outputDir, "daily.md");
    const zhihuMarkdownPath = join(outputDir, "zhihu.md");
    const wechatHtmlPath = join(outputDir, "wechat.html");

    await Promise.all([
      writeFile(dailyMarkdownPath, dailyMarkdown, "utf8"),
      writeFile(zhihuMarkdownPath, zhihuMarkdown, "utf8"),
      writeFile(wechatHtmlPath, wechatHtml, "utf8")
    ]);

    const run = repository.savePipelineRun({
      status: "succeeded",
      startedAt: generatedAt,
      completedAt: new Date().toISOString(),
      config: {
        command: "render-text",
        mockMode: config.MOCK_MODE,
        dailyItemCount: config.DAILY_ITEM_COUNT,
        minCrossRelevanceScore: config.MIN_CROSS_RELEVANCE_SCORE
      },
      result: {
        selectedItems: finalItems.length,
        articleGenerated: articleGenerationResult.generated,
        articleFallback: articleGenerationResult.fallback,
        outputDir,
        dailyMarkdownPath,
        zhihuMarkdownPath,
        wechatHtmlPath
      }
    });

    repository.saveGeneratedOutput({
      runId: run.id,
      outputType: "markdown_daily",
      outputPath: dailyMarkdownPath,
      content: dailyMarkdown,
      metadata: { format: "markdown", date }
    });
    repository.saveGeneratedOutput({
      runId: run.id,
      outputType: "markdown_zhihu",
      outputPath: zhihuMarkdownPath,
      content: zhihuMarkdown,
      metadata: { format: "markdown", platform: "zhihu", date }
    });
    repository.saveGeneratedOutput({
      runId: run.id,
      outputType: "html_wechat",
      outputPath: wechatHtmlPath,
      content: wechatHtml,
      metadata: { format: "html", platform: "wechat", date }
    });

    return {
      generatedAt,
      runId: run.id,
      selectedItems: finalItems,
      outputDir,
      dailyMarkdownPath,
      zhihuMarkdownPath,
      wechatHtmlPath
    };
  } finally {
    repository.close();
  }
}

function normalizeGeneratedAt(date?: string): string {
  if (!date) {
    return new Date().toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    return `${date}T00:00:00.000Z`;
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --date value: ${date}`);
  }
  return parsed.toISOString();
}

async function loadSelectedItems(repository: NewsRepository, config: AppConfig, generatedAt: string): Promise<NewsItem[]> {
  const persistedCandidates = repository.selectCandidates(config.DAILY_ITEM_COUNT, config.MIN_CROSS_RELEVANCE_SCORE);
  if (persistedCandidates.length > 0 || !config.MOCK_MODE) {
    return persistedCandidates;
  }

  const collected = markDuplicateNewsItems(await collectMockNews(new Date(generatedAt)));
  const enriched = await enrichWithMockAi(collected, {
    minCrossRelevanceScore: config.MIN_CROSS_RELEVANCE_SCORE
  });
  const selection = selectAndVerifyItems(enriched, {
    generatedAt,
    dailyItemCount: config.DAILY_ITEM_COUNT,
    categoryCounts: parseCategoryCounts(config.DAILY_CATEGORY_COUNTS),
    lowTrustSourceWeight: config.LOW_TRUST_SOURCE_WEIGHT,
    lowTrustHighScore: config.LOW_TRUST_HIGH_SCORE,
    freshnessHours: config.SELECTION_FRESHNESS_HOURS
  });

  return selection.items.filter((item) => item.selected);
}
