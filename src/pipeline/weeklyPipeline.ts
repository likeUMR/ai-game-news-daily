import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "../config/env.js";
import { openNewsRepository } from "../db/newsRepository.js";
import { renderWeeklyMarkdown, renderWeeklyHtml } from "../render/markdownRenderer.js";
import type { NewsItem } from "./types.js";

export interface WeeklyPipelineResult {
  generatedAt: string;
  runId: string;
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
  const date = generatedAt.slice(0, 10);
  const outputDir = join(config.OUTPUT_DIR, date);

  await mkdir(outputDir, { recursive: true });
  await mkdir(config.DATA_DIR, { recursive: true });

  // 计算过去 7 天的时间范围 (包含基准日期在内的 7 天)
  const end = new Date(generatedAt);
  end.setUTCHours(23, 59, 59, 999);
  const endDateStr = end.toISOString();

  const start = new Date(generatedAt);
  start.setUTCDate(start.getUTCDate() - 6);
  start.setUTCHours(0, 0, 0, 0);
  const startDateStr = start.toISOString();

  const displayStartDate = startDateStr.slice(0, 10);
  const displayEndDate = endDateStr.slice(0, 10);

  const repository = openNewsRepository(config.DATABASE_PATH);
  const limit = options.limit ?? 9;

  try {
    // 1. 获取过去 7 日内所有被日报采纳的新闻并选分数 top 9
    const selectedItems = repository.listWeeklyCandidates(startDateStr, endDateStr, limit);

    // 2. 组装并渲染周报内容 (Markdown 和 HTML)
    const compactDate = generatedAt.slice(0, 10).replace(/-/g, "");
    const weeklyTitle = `智游镜 | 每周AI游戏新闻速递 ${compactDate}`;
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
        startDate: displayStartDate,
        endDate: displayEndDate
      },
      result: {
        selectedItems: selectedItems.length,
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
      metadata: { format: "markdown", startDate: displayStartDate, endDate: displayEndDate }
    });

    repository.saveGeneratedOutput({
      runId: run.id,
      outputType: "html_weekly",
      outputPath: weeklyHtmlPath,
      content: weeklyHtml,
      metadata: { format: "html", startDate: displayStartDate, endDate: displayEndDate }
    });

    return {
      generatedAt,
      runId: run.id,
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
