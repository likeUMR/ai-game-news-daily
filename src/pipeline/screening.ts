import type { AppConfig } from "../config/env.js";
import { createAIProvider } from "../ai/providerFactory.js";
import type { AIProvider } from "../ai/types.js";
import { openNewsRepository, type NewsRepository, type PendingRawItem } from "../db/newsRepository.js";
import type { NewsItem } from "./types.js";

export interface ScreeningOptions {
  limit?: number;
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
}

type NormalizedScreeningOptions = ScreeningOptions & {
  minAiRelevanceScore: number;
  minGameRelevanceScore: number;
};

export async function runScreening(config: AppConfig): Promise<ScreeningResult> {
  const repository = openNewsRepository(config.DATABASE_PATH);
  try {
    return await screenPendingRawItems(repository, createAIProvider(config), {
      limit: config.MAX_ITEMS_TOTAL,
      minAiRelevanceScore: config.MIN_AI_RELEVANCE_SCORE,
      minGameRelevanceScore: config.MIN_GAME_RELEVANCE_SCORE,
      minNewsValueScore: config.MIN_NEWS_VALUE_SCORE,
      minCrossRelevanceScore: config.MIN_CROSS_RELEVANCE_SCORE
    });
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
  const pendingItems = repository.listPendingRawItems(options.limit ?? 500);
  const result: ScreeningResult = {
    processed: 0,
    candidates: 0,
    excluded: 0,
    errors: 0
  };

  for (const rawItem of pendingItems) {
    try {
      const duplicateOfProcessedId = rawItem.duplicateOf
        ? repository.findProcessedItemIdByRawItemId(rawItem.duplicateOf)
        : null;
      const screened = await screenRawItem(provider, rawItem, normalizedOptions, duplicateOfProcessedId);
      repository.saveProcessedFields({ ...screened, rawItemId: rawItem.id });
      repository.saveProcessingAudit({
        rawItemId: rawItem.id,
        processedItemId: screened.id,
        stage: "screening",
        status: screened.isTopicCandidate ? "processed" : "excluded",
        message: screened.isTopicCandidate ? "Item passed automated screening." : screened.exclusionReason,
        metadata: {
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

      result.processed += 1;
      if (screened.isTopicCandidate) {
        result.candidates += 1;
      } else {
        result.excluded += 1;
      }
    } catch (error) {
      result.errors += 1;
      repository.saveProcessingAudit({
        rawItemId: rawItem.id,
        stage: "screening",
        status: "error",
        message: error instanceof Error ? error.message : "Unknown screening error.",
        metadata: { sourceUrl: rawItem.sourceUrl }
      });
    }
  }

  return result;
}

async function screenRawItem(
  provider: AIProvider,
  rawItem: PendingRawItem,
  options: NormalizedScreeningOptions,
  duplicateOfProcessedId: string | null
): Promise<NewsItem> {
  const baseItem = newsItemFromRaw(rawItem);
  const [summary, keywords, classification, article] = await Promise.all([
    provider.summarize(baseItem),
    provider.extractKeywords(baseItem),
    provider.classifyAndFilter(baseItem, { minCrossRelevanceScore: options.minCrossRelevanceScore }),
    provider.generateArticleEntry(baseItem)
  ]);
  const exclusionReasons = determineExclusions(rawItem, classification, options);
  const isTopicCandidate = exclusionReasons.length === 0;
  const score = Math.round(
    (applySourceWeight(classification.crossRelevanceScore, rawItem.sourceWeight) * 0.6)
    + (applySourceWeight(classification.newsValueScore, rawItem.sourceWeight) * 0.4)
  );

  return {
    ...baseItem,
    summary: summary.summary,
    keywords: keywords.keywords,
    category: article.category,
    score,
    newsValueScore: classification.newsValueScore,
    duplicateOf: duplicateOfProcessedId,
    selected: isTopicCandidate && rawItem.duplicateOf === null,
    officialSources: article.officialSources,
    articleTitle: article.title,
    articleBody: article.body,
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
