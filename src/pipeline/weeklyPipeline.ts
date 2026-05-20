import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "../config/env.js";
import { openNewsRepository, type NewsRepository } from "../db/newsRepository.js";
import { renderWeeklyMarkdown, renderWeeklyHtml } from "../render/markdownRenderer.js";
import type { NewsItem } from "./types.js";

export interface WeeklyPipelineResult {
  generatedAt: string;
  runId: string;
  weekKey: string;
  startDate: string;
  endDate: string;
  selectedItems: NewsItem[];
  outputDir: string;
  weeklyMarkdownPath: string;
  weeklyHtmlPath: string;
}

export interface WeeklyPipelineOptions {
  date?: string;
  limit?: number;
}

export async function runWeeklyPipeline(config: AppConfig, options: WeeklyPipelineOptions = {}): Promise<WeeklyPipelineResult> {
  const generatedAt = normalizeGeneratedAt(options.date);
  const week = getIsoWeekInfo(generatedAt);
  const outputDir = join(config.OUTPUT_DIR, "weekly", week.weekKey);

  await mkdir(outputDir, { recursive: true });
  await mkdir(config.DATA_DIR, { recursive: true });

  const displayStartDate = week.startDateStr.slice(0, 10);
  const displayEndDate = week.endDateStr.slice(0, 10);

  const repository = openNewsRepository(config.DATABASE_PATH);
  const limit = options.limit ?? 9;

  try {
    // 1. 周报只聚合本 ISO 周各日报审计中实际采纳的条目，避免数据库历史 selected 状态串入。
    const selectedItems = await listWeeklyItemsFromDailyAudits(
      repository,
      config.OUTPUT_DIR,
      week.startDateStr,
      week.endDateStr,
      limit,
      config.MOCK_MODE
    );

    // 2. 组装并渲染周报内容 (Markdown 和 HTML)
    const weeklyTitle = `智游镜 | 每周AI游戏新闻速递 ${week.weekKey}`;
    const weeklyMarkdown = renderWeeklyMarkdown(
      selectedItems,
      generatedAt,
      displayStartDate,
      displayEndDate,
      { title: weeklyTitle }
    );
    const weeklyHtml = renderWeeklyHtml(
      selectedItems,
      generatedAt,
      displayStartDate,
      displayEndDate,
      { title: weeklyTitle }
    );

    const weeklyMarkdownPath = join(outputDir, "weekly.md");
    const weeklyHtmlPath = join(outputDir, "weekly.html");

    // 3. 写入本地文件
    await Promise.all([
      writeFile(weeklyMarkdownPath, weeklyMarkdown, "utf8"),
      writeFile(weeklyHtmlPath, weeklyHtml, "utf8")
    ]);

    // 4. 保存 pipeline 运行记录到 SQLite 中
    const run = repository.savePipelineRun({
      status: "succeeded",
      startedAt: generatedAt,
      completedAt: new Date().toISOString(),
      config: {
        command: "run-weekly",
        mockMode: config.MOCK_MODE,
        weeklyLimit: limit,
        weekKey: week.weekKey,
        startDate: displayStartDate,
        endDate: displayEndDate
      },
      result: {
        selectedItems: selectedItems.length,
        weekKey: week.weekKey,
        startDate: displayStartDate,
        endDate: displayEndDate,
        outputDir,
        weeklyMarkdownPath,
        weeklyHtmlPath
      }
    });

    // 5. 保存输出文件元数据到 generated_outputs 中
    repository.saveGeneratedOutput({
      runId: run.id,
      outputType: "markdown_weekly",
      outputPath: weeklyMarkdownPath,
      content: weeklyMarkdown,
      metadata: { format: "markdown", weekKey: week.weekKey, startDate: displayStartDate, endDate: displayEndDate }
    });

    repository.saveGeneratedOutput({
      runId: run.id,
      outputType: "html_weekly",
      outputPath: weeklyHtmlPath,
      content: weeklyHtml,
      metadata: { format: "html", weekKey: week.weekKey, startDate: displayStartDate, endDate: displayEndDate }
    });

    return {
      generatedAt,
      runId: run.id,
      weekKey: week.weekKey,
      startDate: displayStartDate,
      endDate: displayEndDate,
      selectedItems,
      outputDir,
      weeklyMarkdownPath,
      weeklyHtmlPath
    };
  } finally {
    repository.close();
  }
}

interface IsoWeekInfo {
  weekKey: string;
  startDateStr: string;
  endDateStr: string;
}

function getIsoWeekInfo(generatedAt: string): IsoWeekInfo {
  const base = new Date(generatedAt);
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const weekday = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - weekday + 1);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);

  return {
    weekKey: formatIsoWeekKey(start),
    startDateStr: start.toISOString(),
    endDateStr: end.toISOString()
  };
}

function formatIsoWeekKey(weekStart: Date): string {
  const thursday = new Date(weekStart);
  thursday.setUTCDate(weekStart.getUTCDate() + 3);
  const weekYear = thursday.getUTCFullYear();

  const weekOneAnchor = new Date(Date.UTC(weekYear, 0, 4));
  const weekOneWeekday = weekOneAnchor.getUTCDay() || 7;
  const weekOneStart = new Date(weekOneAnchor);
  weekOneStart.setUTCDate(weekOneAnchor.getUTCDate() - weekOneWeekday + 1);
  weekOneStart.setUTCHours(0, 0, 0, 0);

  const weekNumber = Math.floor((weekStart.getTime() - weekOneStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${weekYear}-W${String(weekNumber).padStart(2, "0")}`;
}

async function listWeeklyItemsFromDailyAudits(
  repository: NewsRepository,
  outputRoot: string,
  startDate: string,
  endDate: string,
  limit: number,
  includeMock: boolean
): Promise<NewsItem[]> {
  const candidates = new Map<string, NewsItem>();

  for (const date of eachDate(startDate, endDate)) {
    const audit = await readDailySelectionAudit(join(outputRoot, date, "audit", "editorial-selection-audit.json"));
    if (!audit) {
      continue;
    }

    for (const entry of audit.selected) {
      const persisted = repository.getProcessedItem(entry.id);
      if (persisted?.isMock && !includeMock) {
        continue;
      }

      const item = persisted ? { ...persisted, selected: true } : auditEntryToNewsItem(entry, audit.generatedAt);
      candidates.set(item.id, item);
    }
  }

  return [...candidates.values()]
    .sort(compareWeeklyItems)
    .slice(0, limit);
}

async function readDailySelectionAudit(path: string): Promise<DailySelectionAudit | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as DailySelectionAudit;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function auditEntryToNewsItem(entry: DailySelectionAuditEntry, generatedAt: string): NewsItem {
  const publishedAt = estimatePublishedAt(generatedAt, entry.evidence.freshnessHours);
  const summary = `${entry.title} 入选当日日报。`;

  return {
    id: entry.id,
    sourceUrl: entry.sourceUrl,
    sourceName: entry.sourceName,
    sourceType: "ai_game_media",
    sourceWeight: entry.evidence.sourceWeight,
    publishedAt,
    collectedAt: generatedAt,
    rawContent: summary,
    summary,
    keywords: [],
    category: entry.category || entry.evidence.category || "AI x Game",
    score: entry.evidence.score,
    newsValueScore: entry.evidence.score,
    duplicateOf: null,
    selected: true,
    isMock: false,
    officialSources: entry.evidence.officialSources.length > 0 ? entry.evidence.officialSources : [entry.sourceUrl],
    articleTitle: entry.title,
    articleBody: summary,
    introSummary: summary,
    assets: [],
    scriptSegments: [],
    ttsSegments: [],
    timeline: [],
    subtitleSrt: "",
    aiRelevanceScore: entry.evidence.score,
    gameRelevanceScore: entry.evidence.score,
    crossRelevanceScore: entry.evidence.score,
    aiTags: [],
    gameTags: [],
    isTopicCandidate: true,
    exclusionReason: ""
  };
}

function estimatePublishedAt(generatedAt: string, freshnessHours: number | null): string {
  if (freshnessHours === null) {
    return generatedAt;
  }
  const generatedTime = Date.parse(generatedAt);
  if (!Number.isFinite(generatedTime)) {
    return generatedAt;
  }
  return new Date(generatedTime - freshnessHours * 3_600_000).toISOString();
}

function eachDate(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);
  cursor.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function compareWeeklyItems(left: NewsItem, right: NewsItem): number {
  return right.score - left.score
    || right.sourceWeight - left.sourceWeight
    || Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
}

interface DailySelectionAudit {
  generatedAt: string;
  selected: DailySelectionAuditEntry[];
}

interface DailySelectionAuditEntry {
  id: string;
  title: string;
  category: string;
  sourceName: string;
  sourceUrl: string;
  evidence: {
    score: number;
    sourceWeight: number;
    freshnessHours: number | null;
    category: string;
    officialSources: string[];
  };
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
