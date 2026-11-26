import type { AppConfig } from "../config/env.js";
import { createAIProvider } from "../ai/providerFactory.js";
import type { AIProvider } from "../ai/types.js";
import { ModelRequestError } from "../ai/openAiCompatibleProvider.js";
import { hasAiSignal } from "../collectors/rulePrefilter.js";
import { publicationWindow, type PublicationWindow } from "./edition.js";
import { openNewsRepository, type NewsRepository, type PendingRawItem } from "../db/newsRepository.js";
import type { NewsItem } from "./types.js";

export interface ScreeningOptions {
  limit?: number;
  window?: PublicationWindow;
  includeDemo?: boolean;
  minAiRelevanceScore?: number;
  minGameRelevanceScore?: number;
  minNewsValueScore: number;
  minCrossRelevanceScore: number;
}

export interface ScreeningResult {
  processed: number;
  candidates: number;
  excluded: number;
  errors: number;
  modelReviewed: number;
  ruleExcluded: number;
  firstError?: string;
}

type NormalizedScreeningOptions = ScreeningOptions & {
  minAiRelevanceScore: number;
  minGameRelevanceScore: number;
};

export function screeningOptions(config: AppConfig, asOf: string): ScreeningOptions {
  return {
    limit: config.MAX_ITEMS_TOTAL,
    window: publicationWindow(asOf, config.COLLECTION_WINDOW_HOURS),
    includeDemo: config.MOCK_MODE,
    minAiRelevanceScore: config.MIN_AI_RELEVANCE_SCORE,
    minGameRelevanceScore: config.MIN_GAME_RELEVANCE_SCORE,
    minNewsValueScore: config.MIN_NEWS_VALUE_SCORE,
    minCrossRelevanceScore: config.MIN_CROSS_RELEVANCE_SCORE
  };
}

export function requireHealthyScreen(result: ScreeningResult): void {
  if (result.errors) throw new Error(`Screening failed for ${result.errors} item(s) after ${result.processed} completed. Retry pending items. ${result.firstError}`);
}

export async function runScreening(config: AppConfig, asOf = new Date().toISOString()): Promise<ScreeningResult> {
  const repository = openNewsRepository(config.DATABASE_PATH);
  try {
    const result = await screenPendingRawItems(repository, createAIProvider(config), screeningOptions(config, asOf));
    requireHealthyScreen(result);
    return result;
  } finally {
    repository.close();
  }
}

export async function screenPendingRawItems(
  repository: NewsRepository,
  provider: AIProvider,
  options: ScreeningOptions
): Promise<ScreeningResult> {
  const normalizedOptions: NormalizedScreeningOptions = {
    ...options,
    minAiRelevanceScore: options.minAiRelevanceScore ?? 50,
    minGameRelevanceScore: options.minGameRelevanceScore ?? 50
  };
  const pendingItems = repository.listPendingRawItems(options.limit ?? 500, options.window, options.includeDemo);
  const result: ScreeningResult = {
    processed: 0,
    candidates: 0,
    excluded: 0,
    errors: 0,
    modelReviewed: 0,
    ruleExcluded: 0
  };

  let consecutiveErrors = 0;
  for (const rawItem of pendingItems) {
    const baseItem = newsItemFromRaw(rawItem);
    const duplicate = rawItem.duplicateOf ? repository.findProcessedItemIdByRawItemId(rawItem.duplicateOf) : null;
    const gameFeed = ["rss", "web_page", "json_api"].includes(String(rawItem.metadata.collector))
      && ["game_media", "community"].includes(rawItem.sourceType);
    const ruleReason = rawItem.duplicateOf ? "duplicate" : gameFeed && !hasAiSignal(`${baseItem.articleTitle} ${baseItem.rawContent}`)
      ? "no explicit AI signal in game coverage" : "";
    let screened: NewsItem;
    try {
      if (ruleReason) {
        result.ruleExcluded++;
        screened = { ...baseItem, duplicateOf: duplicate, exclusionReason: ruleReason };
      } else {
        result.modelReviewed++;
        screened = await screenRawItem(provider, rawItem, normalizedOptions);
        consecutiveErrors = 0;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown screening error.";
      result.errors++;
      result.firstError ??= message;
      consecutiveErrors++;
      repository.saveProcessingAudit({ rawItemId: rawItem.id, stage: "screening", status: "error", message });
      if (error instanceof ModelRequestError || consecutiveErrors >= 3) break;
      continue;
    }
    const processedId = repository.findProcessedItemIdByRawItemId(rawItem.id) ?? rawItem.id;
    repository.saveProcessedFields({ ...screened, id: processedId, rawItemId: rawItem.id });
    repository.saveProcessingAudit({
      rawItemId: rawItem.id,
      processedItemId: processedId,
      stage: "screening",
      status: screened.isTopicCandidate ? "processed" : "excluded",
      message: screened.isTopicCandidate ? "Item passed automated screening." : screened.exclusionReason,
      metadata: {
        decision: ruleReason ? "rule" : "model",
        newsValueScore: screened.newsValueScore,
        crossRelevanceScore: screened.crossRelevanceScore,
        effectiveNewsValueScore: applySourceWeight(screened.newsValueScore, rawItem.sourceWeight),
        effectiveCrossRelevanceScore: applySourceWeight(screened.crossRelevanceScore, rawItem.sourceWeight),
        thresholds: {
          minAiRelevanceScore: normalizedOptions.minAiRelevanceScore,
          minGameRelevanceScore: normalizedOptions.minGameRelevanceScore,
          minNewsValueScore: normalizedOptions.minNewsValueScore,
          minCrossRelevanceScore: normalizedOptions.minCrossRelevanceScore
        }
      }
    });

    result.processed++;
    if (screened.isTopicCandidate) result.candidates++;
    else result.excluded++;
  }

  return result;
}

async function screenRawItem(
  provider: AIProvider,
  rawItem: PendingRawItem,
  options: NormalizedScreeningOptions
): Promise<NewsItem> {
  const baseItem = newsItemFromRaw(rawItem);
  const classification = await provider.classifyAndFilter(baseItem, { minCrossRelevanceScore: options.minCrossRelevanceScore });
  const exclusionReasons = determineExclusions(rawItem, classification, options);
  if (!classification.isTopicCandidate && !exclusionReasons.length) exclusionReasons.push("model rejected topic");
  const isTopicCandidate = exclusionReasons.length === 0;
  const [summary, keywords] = isTopicCandidate
    ? await Promise.all([provider.summarize(baseItem), provider.extractKeywords(baseItem)])
    : [{ summary: "", introSummary: "" }, { keywords: [] }];
  const score = Math.round(
    (applySourceWeight(classification.crossRelevanceScore, rawItem.sourceWeight) * 0.6)
    + (applySourceWeight(classification.newsValueScore, rawItem.sourceWeight) * 0.4)
  );

  return {
    ...baseItem,
    summary: summary.summary,
    keywords: keywords.keywords,
    category: isTopicCandidate ? "AI x Game" : "Excluded",
    score,
    newsValueScore: classification.newsValueScore,
    duplicateOf: null,
    selected: false,
    officialSources: [rawItem.sourceUrl],
    articleBody: rawItem.rawContent,
    introSummary: summary.introSummary,
    aiRelevanceScore: classification.aiRelevanceScore,
    gameRelevanceScore: classification.gameRelevanceScore,
    crossRelevanceScore: classification.crossRelevanceScore,
    aiTags: classification.aiTags,
    gameTags: classification.gameTags,
    isTopicCandidate,
    exclusionReason: exclusionReasons.join("; ")
  };
}

function newsItemFromRaw(rawItem: PendingRawItem): NewsItem {
  const title = typeof rawItem.metadata.title === "string" ? rawItem.metadata.title : "";

  return {
    id: rawItem.id,
    sourceUrl: rawItem.sourceUrl,
    sourceName: rawItem.sourceName,
    sourceType: rawItem.sourceType,
    sourceWeight: rawItem.sourceWeight,
    publishedAt: rawItem.publishedAt,
    collectedAt: rawItem.collectedAt,
    rawContent: rawItem.rawContent,
    summary: "",
    keywords: [],
    category: "",
    score: 0,
    newsValueScore: 0,
    duplicateOf: rawItem.duplicateOf,
    selected: false,
    isMock: rawItem.metadata.collector === "demo",
    officialSources: [],
    articleTitle: title,
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
}

function determineExclusions(
  rawItem: PendingRawItem,
  classification: {
    newsValueScore: number;
    aiRelevanceScore: number;
    gameRelevanceScore: number;
    crossRelevanceScore: number;
    exclusionReasons: string[];
  },
  options: NormalizedScreeningOptions
): string[] {
  const reasons = new Set<string>();
  const text = `${String(rawItem.metadata.title ?? "")} ${rawItem.rawContent}`.toLowerCase();
  const effectiveNewsValue = applySourceWeight(classification.newsValueScore, rawItem.sourceWeight);
  const effectiveCrossRelevance = applySourceWeight(classification.crossRelevanceScore, rawItem.sourceWeight);

  for (const reason of classification.exclusionReasons) {
    const normalized = normalizeExclusionReason(reason);
    if (normalized) {
      reasons.add(normalized);
    }
  }

  if (rawItem.duplicateOf) {
    reasons.add("duplicate");
  }
  if (classification.aiRelevanceScore < options.minAiRelevanceScore) {
    reasons.add("non-ai game news");
  }
  if (classification.gameRelevanceScore < options.minGameRelevanceScore) {
    reasons.add("ai news without game relevance");
  }
  if (
    classification.aiRelevanceScore < options.minAiRelevanceScore
    && classification.gameRelevanceScore < options.minGameRelevanceScore
  ) {
    reasons.add("unrelated to AI x game");
  }
  if (/\b(tutorial|how to|guide|tips|prompt pack|course|learn)\b/.test(text) && classification.newsValueScore < 70) {
    reasons.add("generic tutorial");
  }
  if (/\b(celebrity|rumor|gossip|cosplay|meme|trailer reaction|fan art)\b/.test(text)) {
    reasons.add("pure entertainment gossip");
  }
  if (/\b(repost|roundup|ICYMI|in case you missed it)\b/i.test(text) || rawItem.rawContent.trim().length < 50) {
    reasons.add("low-information repost");
  }
  if (effectiveCrossRelevance < options.minCrossRelevanceScore) {
    reasons.add("cross relevance below threshold");
  }
  if (effectiveNewsValue < options.minNewsValueScore) {
    reasons.add("news value below threshold");
  }

  return [...reasons];
}

function normalizeExclusionReason(reason: string): string {
  const normalized = reason.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "keep") {
    return "";
  }
  if (normalized.includes("non-ai") || normalized.includes("no ai")) {
    return "non-ai game news";
  }
  if (normalized.includes("tutorial") || normalized.includes("guide")) {
    return "generic tutorial";
  }
  if (normalized.includes("gossip") || normalized.includes("entertainment")) {
    return "pure entertainment gossip";
  }
  if (normalized.includes("repost") || normalized.includes("low information")) {
    return "low-information repost";
  }
  if (normalized.includes("unrelated")) {
    return "unrelated to AI x game";
  }
  return normalized;
}

export function applySourceWeight(score: number, sourceWeight: number): number {
  return clampScore(Math.round(score + ((sourceWeight - 50) * 0.25)));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}
