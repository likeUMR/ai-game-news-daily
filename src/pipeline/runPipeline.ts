import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAIProvider } from "../ai/providerFactory.js";
import type { AppConfig } from "../config/env.js";
import { collectMockNews } from "../collectors/mockCollector.js";
import { collectIntoSqlite, writeCollectionAudit } from "../collectors/collectNews.js";
import { enrichWithMockAi } from "../ai/mockAi.js";
import { openNewsRepository } from "../db/newsRepository.js";
import {
  renderDailyMarkdown,
  renderWeChatHtml,
  renderZhihuMarkdown
} from "../render/markdownRenderer.js";
import { renderVideoFrames } from "../video/frameRenderer.js";
import { planVideoNarration } from "../video/narrationPlanner.js";
import { createVideoComposer, type VideoCompositionResult } from "../video/videoComposer.js";
import { createDistributionExportPackages } from "../distribution/exportPackages.js";
import { markDuplicateNewsItems } from "./dedupe.js";
import { generateArticlesForSelectedItems } from "./articleGeneration.js";
import { editionDay, editionTime, publicationWindow, requireEditionItems, writeEditionFile } from "./edition.js";
import { requireHealthyScreen, screenPendingRawItems, screeningOptions } from "./screening.js";
import { parseCategoryCounts, selectAndVerifyItems, writeSelectionAudit } from "./selection.js";
import type { PipelineResult, NewsItem } from "./types.js";

export interface RunPipelineOptions {
  date?: string;
  limit?: number;
}

interface StageSummary {
  name: string;
  status: "succeeded" | "failed";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error?: string;
  summary?: Record<string, unknown>;
}

export async function runPipeline(config: AppConfig, options: RunPipelineOptions = {}): Promise<PipelineResult> {

  const generatedAt = editionTime(options.date);
  const dailyItemCount = options.limit ?? config.DAILY_ITEM_COUNT;
  const runStartedAt = new Date().toISOString();
  const stages: StageSummary[] = [];
  const errors: Array<{ stage: string; message: string }> = [];
  const date = editionDay(generatedAt);
  const window = publicationWindow(generatedAt, config.COLLECTION_WINDOW_HOURS);
  const outputDir = join(config.OUTPUT_DIR, date);
  await mkdir(config.OUTPUT_DIR, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(config.DATA_DIR, { recursive: true });
  const effectiveModelProvider = config.MOCK_MODE ? "mock" : config.MODEL_PROVIDER;
  console.log(`[pipeline] START run-daily date=${date} mock=${config.MOCK_MODE} provider=${effectiveModelProvider}`);

  const repository = openNewsRepository(config.DATABASE_PATH);
  const run = repository.savePipelineRun({
    status: "running",
    startedAt: runStartedAt,
    config: {
      command: "run-daily",
      mockMode: config.MOCK_MODE,
      date,
      dailyItemCount,
      minCrossRelevanceScore: config.MIN_CROSS_RELEVANCE_SCORE
    },
    result: {}
  });

  let selectedItems = [] as NewsItem[];
  let enriched = [] as NewsItem[];
  let auditPath = "";
  let collectionAuditPath = "";
  let markdownPath = "";
  let dailyMarkdownPath = "";
  let zhihuMarkdownPath = "";
  let wechatHtmlPath = "";
  let videoPlanPath = "";
  let runPath = "";
  let distributionDir = "";
  let distributionManifestPath = "";
  let composition: VideoCompositionResult | undefined;

  try {
    const collected = await runStage(stages, errors, "collect", async () => {
      let items: NewsItem[] = [];
      let collectionSummary: Record<string, unknown> = {};
      if (config.MOCK_MODE) {
        items = markDuplicateNewsItems(await collectMockNews(new Date(generatedAt)));
        collectionSummary = {
          fetchedItems: items.length,
          insertedItems: items.length,
          skippedDuplicates: 0,
          collectionFailures: 0
        };
      } else {
        const collection = await collectIntoSqlite(config, new Date(generatedAt));
        collectionAuditPath = await writeCollectionAudit(outputDir, collection);
        if (!collection.items.length && collection.failures.length) {
          throw new Error(`Collection returned no articles with ${collection.failures.length} source failure(s). See ${collectionAuditPath}`);
        }
        if (collection.failures.length) console.warn(`[collect] ${collection.failures.length} source failure(s). See ${collectionAuditPath}`);
        collectionSummary = {
          fetchedItems: collection.items.length,
          withinWindow: collection.items.length - collection.outsideWindow,
          outsideWindow: collection.outsideWindow,
          insertedItems: collection.inserted,
          skippedDuplicates: collection.skippedDuplicates,
          markedDuplicates: collection.markedDuplicates,
          collectionFailures: collection.failures.length,
          collectionAuditPath
        };
      }
      return {
        value: items,
        summary: {
          ...collectionSummary
        }
      };
    });

    enriched = await runStage(stages, errors, "screen", async () => {
      let items: NewsItem[] = [];
      let screeningSummary = {};
      if (config.MOCK_MODE) {
        items = await enrichWithMockAi(collected, {
          minCrossRelevanceScore: config.MIN_CROSS_RELEVANCE_SCORE
        });
      } else {
        const provider = createAIProvider(config);
        const screened = await screenPendingRawItems(repository, provider, screeningOptions(config, generatedAt));
        requireHealthyScreen(screened);
        screeningSummary = screened;
        items = repository.listEditionItems(window, false);
      }
      return {
        value: items,
        summary: {
          ...screeningSummary,
          editionItems: items.length,
          candidates: items.filter((item) => item.isTopicCandidate).length
        }
      };
    });

    const selection = await runStage(stages, errors, "select", async () => {
      const selected = selectAndVerifyItems(enriched, {
        generatedAt,
        dailyItemCount,
        categoryCounts: parseCategoryCounts(config.DAILY_CATEGORY_COUNTS),
        lowTrustSourceWeight: config.LOW_TRUST_SOURCE_WEIGHT,
        lowTrustHighScore: config.LOW_TRUST_HIGH_SCORE,
        freshnessHours: config.SELECTION_FRESHNESS_HOURS
      });
      await writeSelectionAudit(outputDir, selected.audit, "latest-selection-attempt.json");
      if (!config.MOCK_MODE) requireEditionItems(selected.audit.selected.length, date);

      if (!config.MOCK_MODE) {
        for (const item of selected.items) {
          repository.saveProcessedFields(item);
        }
      }

      const audit = join(outputDir, "audit", "editorial-selection-audit.json");
      return {
        value: { selection: selected, auditPath: audit },
        summary: {
          selectedItems: selected.audit.selected.length,
          rejectedItems: selected.audit.rejected.length,
          duplicateItems: selected.audit.duplicate.length,
          failedVerificationItems: selected.audit.failedVerification.length,
          auditPath: audit
        }
      };
    });
    auditPath = selection.auditPath;
    selectedItems = selection.selection.items.filter((item) => item.selected);

    const articleResult = await runStage(stages, errors, "generate-article", async () => {
      const generated = await generateArticlesForSelectedItems(
        repository,
        createAIProvider(config),
        selectedItems
      );
      return {
        value: generated.items.filter((item) => item.selected),
        summary: {
          generatedItems: generated.generated,
          fallbackItems: generated.fallback,
          validationFailures: generated.validationFailures.length
        }
      };
    });
    selectedItems = articleResult;

    markdownPath = await runStage(stages, errors, "render-text", async () => {
      const dailyMarkdown = renderDailyMarkdown(selectedItems, generatedAt);
      const zhihuMarkdown = renderZhihuMarkdown(selectedItems, generatedAt);
      const legacyPath = join(outputDir, "daily-report.md");
      dailyMarkdownPath = join(outputDir, "daily.md");
      zhihuMarkdownPath = join(outputDir, "zhihu.md");
      wechatHtmlPath = join(outputDir, "wechat.html");
      await Promise.all([
        writeFile(legacyPath, dailyMarkdown, "utf8"),
        writeFile(dailyMarkdownPath, dailyMarkdown, "utf8"),
        writeFile(zhihuMarkdownPath, zhihuMarkdown, "utf8")
      ]);
      return {
        value: legacyPath,
        summary: {
          markdownPath: legacyPath,
          dailyMarkdownPath,
          zhihuMarkdownPath,
          wechatHtmlPath
        }
      };
    });

    const narration = await runStage(stages, errors, "plan-video", async () => {
      const plan = await planVideoNarration(selectedItems, {
        generatedAt,
        outputRoot: config.OUTPUT_DIR,
        ttsProviderName: config.TTS_PROVIDER,
        repository
      });
      selectedItems = plan.items;
      return {
        value: plan,
        summary: {
          subtitlePath: plan.subtitlePath,
          timelineEvents: plan.timeline.length,
          scriptSegments: plan.scriptSegments.length
        }
      };
    });

    const frames = await runStage(stages, errors, "render-frames", async () => {
      const rendered = await renderVideoFrames(selectedItems, narration.timeline, {
        generatedAt,
        outputRoot: config.OUTPUT_DIR,
        dimensions: {
          width: config.VIDEO_FRAME_WIDTH,
          height: config.VIDEO_FRAME_HEIGHT
        },
        renderer: config.MOCK_MODE ? "placeholder" : "auto"
      });
      return {
        value: rendered,
        summary: {
          renderer: rendered.renderer,
          frameCount: rendered.frames.length,
          htmlDir: rendered.htmlDir,
          pngDir: rendered.pngDir,
          error: rendered.error
        }
      };
    });

    const videoPlan: {
      mode: string;
      timeline: unknown[];
      subtitles: string;
      subtitlePath: string;
      scriptSegments: string[];
      frames?: unknown;
      composition?: VideoCompositionResult;
    } = {
      mode: config.MOCK_MODE ? "mock" : "production",
      timeline: narration.timeline,
      subtitles: narration.subtitleSrt,
      subtitlePath: narration.subtitlePath,
      scriptSegments: narration.scriptSegments,
      frames: {
        renderer: frames.renderer,
        dimensions: frames.dimensions,
        htmlDir: frames.htmlDir,
        pngDir: frames.pngDir,
        count: frames.frames.length,
        error: frames.error,
        frames: frames.frames.map((frame) => ({
          id: frame.id,
          kind: frame.kind,
          htmlPath: frame.htmlPath,
          pngPath: frame.pngPath,
          metadata: frame.metadata
        }))
      }
    };

    composition = await runStage(stages, errors, "compose-video", async () => {
      const composer = await createVideoComposer({ force: config.MOCK_MODE ? "mock" : "auto" });
      const composed = await composer.compose({
        generatedAt,
        outputRoot: config.OUTPUT_DIR,
        frames: frames.frames,
        timeline: narration.timeline,
        subtitleSrt: narration.subtitleSrt,
        subtitlePath: narration.subtitlePath
      });
      return {
        value: composed,
        summary: {
          mode: composed.mode,
          videoPath: composed.videoPath,
          auditPath: composed.auditPath,
          subtitlePath: composed.subtitlePath
        }
      };
    });
    videoPlan.composition = composition;

    const distribution = await runStage(stages, errors, "prepare-distribution", async () => {
      const prepared = await createDistributionExportPackages({
        generatedAt,
        outputRoot: config.OUTPUT_DIR,
        items: selectedItems,
        markdownPath,
        videoPath: composition?.videoPath,
        subtitlePath: composition?.subtitlePath
      });
      distributionDir = prepared.distributionDir;
      distributionManifestPath = prepared.manifestPath;
      return {
        value: prepared,
        summary: {
          distributionDir: prepared.distributionDir,
          manifestPath: prepared.manifestPath,
          platforms: prepared.packages.map((item) => item.platform)
        }
      };
    });

    videoPlanPath = join(outputDir, "video-plan.json");
    await writeFile(videoPlanPath, `${JSON.stringify(videoPlan, null, 2)}\n`, "utf8");
    await writeEditionFile(wechatHtmlPath, renderWeChatHtml(selectedItems, generatedAt));
    const publishedAudit = selection.selection.audit;
    const publishedItems = new Map(selectedItems.map((item) => [item.id, item]));
    for (const entry of publishedAudit.selected) {
      const { articleTitle, articleBody, introSummary, publishedAt } = publishedItems.get(entry.id)!;
      entry.article = { articleTitle, articleBody, introSummary, publishedAt };
    }
    await writeSelectionAudit(outputDir, publishedAudit);
    runPath = join(outputDir, "pipeline-run.json");

    const result: PipelineResult = {
      generatedAt,
      runId: run.id,
      enrichedItems: selection.selection.items,
      selectedItems,
      auditPath,
      collectionAuditPath: collectionAuditPath || undefined,
      markdownPath,
      videoPlanPath,
      videoPath: composition.videoPath,
      videoCompositionAuditPath: composition.auditPath,
      distributionDir: distribution.distributionDir,
      distributionManifestPath: distribution.manifestPath,
      frameHtmlDir: frames.htmlDir,
      framePngDir: frames.pngDir,
      runPath
    };

    const generatedOutputs = [
      {
        outputType: "markdown_daily",
        outputPath: dailyMarkdownPath,
        metadata: { format: "markdown", date }
      },
      {
        outputType: "markdown_zhihu",
        outputPath: zhihuMarkdownPath,
        metadata: { format: "markdown", platform: "zhihu", date }
      },
      {
        outputType: "html_wechat",
        outputPath: wechatHtmlPath,
        metadata: { format: "html", platform: "wechat", date }
      },
      {
        outputType: "subtitles_srt",
        outputPath: composition.subtitlePath,
        metadata: { format: "srt", date }
      },
      {
        outputType: "distribution_manifest",
        outputPath: distribution.manifestPath,
        metadata: { format: "json", date, directory: distribution.distributionDir }
      },
      {
        outputType: "video_daily",
        outputPath: composition.videoPath,
        metadata: {
          format: "mp4",
          date,
          mode: composition.mode,
          subtitlePath: composition.subtitlePath,
          auditPath: composition.auditPath,
          note: composition.note
        }
      }
    ];

    for (const output of generatedOutputs) {
      repository.saveGeneratedOutput({
        runId: run.id,
        ...output
      });
    }

    const completedAt = new Date().toISOString();
    const finalResult = {
      ...result,
      pipelineRun: {
        id: run.id,
        status: "succeeded",
        startedAt: runStartedAt,
        completedAt,
        durationMs: Date.parse(completedAt) - Date.parse(runStartedAt),
        stages,
        errors,
        artifactPaths: {
          text: markdownPath,
          collectionAudit: collectionAuditPath || undefined,
          dailyMarkdown: dailyMarkdownPath,
          zhihuMarkdown: zhihuMarkdownPath,
          wechatHtml: wechatHtmlPath,
          audit: auditPath,
          subtitles: composition.subtitlePath,
          frameHtmlDir: frames.htmlDir,
          framePngDir: frames.pngDir,
          videoPlan: videoPlanPath,
          video: composition.videoPath,
          videoAudit: composition.auditPath,
          distribution: distribution.distributionDir,
          distributionManifest: distribution.manifestPath,
          run: runPath
        }
      }
    };

    repository.savePipelineRun({
      id: run.id,
      status: "succeeded",
      startedAt: runStartedAt,
      completedAt,
      config: {
        command: "run-daily",
        mockMode: config.MOCK_MODE,
        date,
        dailyItemCount,
        minCrossRelevanceScore: config.MIN_CROSS_RELEVANCE_SCORE
      },
      result: finalResult.pipelineRun
    });
    await writeFile(runPath, `${JSON.stringify(finalResult, null, 2)}\n`, "utf8");
    console.log(`[pipeline] OK run-daily durationMs=${finalResult.pipelineRun.durationMs} selectedItems=${selectedItems.length}`);

    return result;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[pipeline] FAIL run-daily error=${message}`);
    repository.savePipelineRun({
      id: run.id,
      status: "failed",
      startedAt: runStartedAt,
      completedAt,
      config: {
        command: "run-daily",
        mockMode: config.MOCK_MODE,
        date,
        dailyItemCount,
        minCrossRelevanceScore: config.MIN_CROSS_RELEVANCE_SCORE
      },
      result: {
        stages,
        errors,
        artifactPaths: {
          text: markdownPath,
          collectionAudit: collectionAuditPath || undefined,
          dailyMarkdown: dailyMarkdownPath,
          zhihuMarkdown: zhihuMarkdownPath,
          wechatHtml: wechatHtmlPath,
          audit: auditPath,
          videoPlan: videoPlanPath,
          video: composition?.videoPath,
          videoAudit: composition?.auditPath,
          distribution: distributionDir || undefined,
          distributionManifest: distributionManifestPath || undefined,
          run: runPath
        }
      },
      error: message
    });
    throw error;
  } finally {
    repository.close();
  }
}

async function runStage<T>(
  stages: StageSummary[],
  errors: Array<{ stage: string; message: string }>,
  name: string,
  action: () => Promise<{ value: T; summary?: Record<string, unknown> }>
): Promise<T> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  console.log(`[pipeline] START ${name}`);
  try {
    const result = await action();
    const completedAt = new Date().toISOString();
    const durationMs = Math.round(performance.now() - started);
    stages.push({
      name,
      status: "succeeded",
      startedAt,
      completedAt,
      durationMs,
      summary: result.summary
    });
    console.log(`[pipeline] OK ${name} durationMs=${durationMs}${formatStageSummary(result.summary)}`);
    return result.value;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Math.round(performance.now() - started);
    stages.push({
      name,
      status: "failed",
      startedAt,
      completedAt,
      durationMs,
      error: message
    });
    errors.push({ stage: name, message });
    console.error(`[pipeline] FAIL ${name} durationMs=${durationMs} error=${message}`);
    throw error;
  }
}

function formatStageSummary(summary?: Record<string, unknown>): string {
  if (!summary) {
    return "";
  }
  const entries = Object.entries(summary)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .map(([key, value]) => `${key}=${String(value)}`);
  return entries.length > 0 ? ` ${entries.join(" ")}` : "";
}
