import { config as loadDotenvFile } from "dotenv";
import { loadConfig, loadEnvFiles, type AppConfig } from "../config/env.js";
import { collectIntoSqlite } from "../collectors/collectNews.js";
import { openNewsRepository } from "../db/newsRepository.js";
import { runArticleGeneration } from "../pipeline/articleGeneration.js";
import { runPipeline } from "../pipeline/runPipeline.js";
import { runScreening } from "../pipeline/screening.js";
import { runSelection } from "../pipeline/selectionStage.js";
import { runTextRendering } from "../pipeline/textRendering.js";
import { runWeeklyPipeline } from "../pipeline/weeklyPipeline.js";

interface CliOptions {
  command: string;
  date?: string;
  mock?: boolean;
  limit?: number;
  configPath?: string;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  loadEnvFiles();
  applyConfigFile(options);
  const config = buildConfig(options);

  if (options.command === "init-db") {
    const repository = openNewsRepository(config.DATABASE_PATH);
    repository.close();
    console.log(`Initialized database: ${config.DATABASE_PATH}`);
    return;
  }

  if (options.command === "collect" || options.command === "ingest") {
    const result = await collectIntoSqlite(config);
    console.log(`Collected ${result.items.length} item(s).`);
    console.log(`Inserted ${result.inserted} new raw item(s); skipped ${result.skippedDuplicates} duplicate(s).`);
    console.log(`Marked ${result.markedDuplicates} likely duplicate(s).`);
    if (result.failures.length > 0) {
      console.log(`Collection failures: ${result.failures.length}`);
    }
    return;
  }

  if (options.command === "screen" || options.command === "screening") {
    const result = await runScreening(config);
    console.log(`Screened ${result.processed} item(s).`);
    console.log(`Candidates: ${result.candidates}; excluded: ${result.excluded}; errors: ${result.errors}.`);
    return;
  }

  if (options.command === "select") {
    const result = await runSelection(config, { date: options.date });
    console.log(`Selection completed with ${result.selectedItems.length} selected item(s).`);
    console.log(`Audit: ${result.auditPath}`);
    return;
  }

  if (options.command === "generate-article" || options.command === "articles" || options.command === "article-generation") {
    const result = await runArticleGeneration(config);
    console.log(`Generated article content for ${result.generated} selected item(s).`);
    console.log(`Fallback article content used for ${result.fallback} item(s).`);
    return;
  }

  if (options.command === "render-text" || options.command === "text") {
    const result = await runTextRendering(config, { date: options.date });
    console.log(`Rendered text edition for ${result.selectedItems.length} selected item(s).`);
    console.log(`Daily Markdown: ${result.dailyMarkdownPath}`);
    console.log(`Zhihu Markdown: ${result.zhihuMarkdownPath}`);
    console.log(`WeChat HTML: ${result.wechatHtmlPath}`);
    return;
  }

  if (options.command === "run-weekly" || options.command === "weekly") {
    const result = await runWeeklyPipeline(config, { date: options.date, limit: options.limit });
    console.log(`Weekly Pipeline completed with ${result.selectedItems.length} selected item(s) from ${result.startDate} to ${result.endDate}.`);
    console.log(`Weekly Markdown: ${result.weeklyMarkdownPath}`);
    console.log(`Weekly WeChat HTML: ${result.weeklyHtmlPath}`);
    return;
  }

  if (["run", "run-daily", "collect-run", "plan-video", "render-frames", "compose-video"].includes(options.command)) {
    const result = await runPipeline(config, { date: options.date, limit: options.limit });
    console.log(`Pipeline completed with ${result.selectedItems.length} selected item(s).`);
    console.log(`Markdown: ${result.markdownPath}`);
    console.log(`Audit: ${result.auditPath}`);
    console.log(`Video audit: ${result.videoCompositionAuditPath ?? "not generated"}`);
    console.log(`Frames: ${result.framePngDir}`);
    console.log(`Video plan: ${result.videoPlanPath}`);
    console.log(`Video: ${result.videoPath ?? "not generated"}`);
    console.log(`Distribution: ${result.distributionDir ?? "not generated"}`);
    console.log(`Run artifact: ${result.runPath}`);
    return;
  }

  throw new Error(`Unknown command: ${options.command}`);
}

function parseCliOptions(args: string[]): CliOptions {
  const command = args[0]?.startsWith("--") ? "run" : args[0] ?? "run";
  const optionArgs = args[0]?.startsWith("--") ? args : args.slice(1);
  const options: CliOptions = { command };

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index]!;
    if (arg === "--mock") {
      options.mock = true;
      continue;
    }
    if (arg === "--date") {
      options.date = readOptionValue(optionArgs, ++index, "--date");
      continue;
    }
    if (arg === "--limit") {
      const value = Number.parseInt(readOptionValue(optionArgs, ++index, "--limit"), 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --limit value: ${optionArgs[index]}`);
      }
      options.limit = value;
      continue;
    }
    if (arg === "--config") {
      options.configPath = readOptionValue(optionArgs, ++index, "--config");
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function readOptionValue(args: string[], index: number, optionName: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

function applyConfigFile(options: CliOptions): void {
  if (!options.configPath) {
    return;
  }

  const result = loadDotenvFile({ path: options.configPath, override: true });
  if (result.error) {
    throw result.error;
  }
}

function buildConfig(options: CliOptions): AppConfig {
  const env = { ...process.env };
  if (options.mock) {
    env.MOCK_MODE = "true";
    env.MODEL_PROVIDER = "mock";
    env.TTS_PROVIDER = "mock";
    env.VIDEO_COMPOSER_MODE = "mock";
  }
  if (options.limit !== undefined) {
    env.MAX_ITEMS_TOTAL = String(options.limit);
    env.DAILY_ITEM_COUNT = String(options.limit);
  }
  return loadConfig(env);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
