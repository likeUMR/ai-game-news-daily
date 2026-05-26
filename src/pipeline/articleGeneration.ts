import type { AppConfig } from "../config/env.js";
import { createAIProvider } from "../ai/providerFactory.js";
import type { AIProvider, ArticleGenerationContextGroup } from "../ai/types.js";
import type { NewsRepository } from "../db/newsRepository.js";
import { openNewsRepository } from "../db/newsRepository.js";
import { canonicalizeUrl } from "./dedupe.js";
import type { NewsItem } from "./types.js";

export interface ArticleGenerationResult {
  items: NewsItem[];
  generated: number;
  fallback: number;
  validationFailures: Array<{ itemId: string; reasons: string[] }>;
}

export async function runArticleGeneration(config: AppConfig): Promise<ArticleGenerationResult> {
  const repository = openNewsRepository(config.DATABASE_PATH);
  try {
    const selectedItems = repository.selectCandidates(config.DAILY_ITEM_COUNT, config.MIN_CROSS_RELEVANCE_SCORE);
    return await generateArticlesForSelectedItems(repository, createAIProvider(config), selectedItems);
  } finally {
    repository.close();
  }
}

interface GeneratedArticleFields {
  articleTitle: string;
  articleBody: string;
  introSummary: string;
  sourceLinks: string[];
}

const stopwords = new Set([
  "about", "across", "after", "again", "announced", "around", "article", "because", "before", "being",
  "between", "daily", "during", "entry", "general", "industry", "into", "latest", "official", "reported",
  "report", "reports", "source", "their", "there", "these", "this", "through", "today", "update", "using",
  "with", "without", "workflows"
]);

export async function generateArticlesForSelectedItems(
  repository: NewsRepository,
  provider: AIProvider,
  items: NewsItem[]
): Promise<ArticleGenerationResult> {
  const selectedItems = items.filter((item) => item.selected);
  const groups = groupSelectedByCategory(selectedItems);
  let generatedEntries: Map<string, GeneratedArticleFields>;

  try {
    const response = await provider.generateArticleEntries(groups);
    generatedEntries = new Map(response.entries.map((entry) => [entry.id, {
      articleTitle: entry.articleTitle,
      articleBody: entry.articleBody,
      introSummary: entry.introSummary,
      sourceLinks: entry.sourceLinks
    }]));
  } catch {
    generatedEntries = new Map();
  }

  const validationFailures: ArticleGenerationResult["validationFailures"] = [];
  let generated = 0;
  let fallback = 0;

  const nextItems = items.map((item) => {
    if (!item.selected) {
      return item;
    }

    const entry = generatedEntries.get(item.id);
    const validation = entry ? validateGeneratedArticle(item, entry) : { ok: false, reasons: ["AI article generation failed"] };
    if (!validation.ok || !entry) {
      validationFailures.push({ itemId: item.id, reasons: validation.reasons });
      fallback += 1;
      const updated = buildFallbackArticle(item);
      repository.saveProcessedFields(updated);
      return updated;
    }

    generated += 1;
    const fields = entry;
    const sourceLinks = preserveSourceLinks(item, fields.sourceLinks);
    const normalizedIntroSummary = normalizeIntroSummary(fields.introSummary, item, fields.articleTitle);
    const normalizedArticleBody = normalizeArticleBody(fields.articleBody);
    const updated = {
      ...item,
      articleTitle: fields.articleTitle.trim(),
      articleBody: normalizedArticleBody,
      introSummary: normalizedIntroSummary,
      officialSources: sourceLinks
    };

    repository.saveProcessedFields(updated);
    return updated;
  });

  return { items: nextItems, generated, fallback, validationFailures };
}

function buildFallbackArticle(item: NewsItem): NewsItem {
  const title = firstContentLine(item.rawContent) || item.articleTitle || item.summary || "AI x 游戏候选新闻";
  const summary = item.summary || firstContentLine(item.rawContent) || item.articleTitle;
  const rawDetail = item.rawContent
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1)
    .join(" ");
  const detail = rawDetail || summary;

  return {
    ...item,
    articleTitle: clampText(title, 80),
    articleBody: [
      `1. ${clampText(summary, 180)}`,
      `2. ${clampText(detail, 180)}`,
      `3. 来源：${item.sourceName}；本条采用原始采集内容生成保守摘要，避免发布未通过验证的扩展判断。`
    ].join("\n"),
    introSummary: clampText(summary, 80),
    officialSources: preserveSourceLinks(item, item.officialSources)
  };
}

export function groupSelectedByCategory(items: NewsItem[]): ArticleGenerationContextGroup[] {
  const groups = new Map<string, NewsItem[]>();
  for (const item of items.filter((candidate) => candidate.selected)) {
    const category = item.category.trim() || "Uncategorized";
    groups.set(category, [...(groups.get(category) ?? []), item]);
  }
  return [...groups.entries()].map(([category, groupedItems]) => ({ category, items: groupedItems }));
}

function validateGeneratedArticle(item: NewsItem, entry: GeneratedArticleFields): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const rawIntroSummary = compactIntroSummary(entry.introSummary);
  const introSummary = normalizeIntroSummary(entry.introSummary, item, entry.articleTitle);
  const articleBody = normalizeArticleBody(entry.articleBody);
  if (entry.articleTitle.trim().length === 0) {
    reasons.push("article title is empty");
  }
  if (introSummary.length === 0) {
    reasons.push("intro summary is empty");
  }
  if (!/[\p{Script=Han}]/u.test(rawIntroSummary)) {
    reasons.push("intro summary must contain Chinese");
  }
  if (articleBody.length === 0) {
    reasons.push("article body is empty");
  }
  if (!hasPreservedSourceLink(item, entry.sourceLinks)) {
    reasons.push("source links are missing");
  }
  if (articleBody.split(/\n{2,}/).some((paragraph) => paragraph.trim().length > 500)) {
    reasons.push("article body contains an overlong paragraph");
  }
  const numberedPoints = articleBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s+/.test(line));
  if (numberedPoints.length !== 3) {
    reasons.push("article body must contain exactly 3 numbered points");
  }
  if (numberedPoints.some((line) => line.length < 12)) {
    reasons.push("article body numbered points are too short");
  }
  if (
    isCommentaryTooSimilar(entry.articleTitle, rawIntroSummary)
    || isCommentaryTooSimilar(entry.articleTitle, introSummary)
  ) {
    reasons.push("intro summary is too similar to the title");
  }
  if (looksLikeMojibake(`${entry.articleTitle} ${introSummary} ${articleBody}`)) {
    reasons.push("generated text appears mojibake-corrupted");
  }
  if (!claimsTraceToEvidence(item, { ...entry, introSummary, articleBody })) {
    reasons.push("generated claims do not trace to raw content, summary, or source metadata");
  }

  return { ok: reasons.length === 0, reasons };
}

function normalizeIntroSummary(value: string, _item: NewsItem, title: string): string {
  const compact = compactIntroSummary(value);
  const firstSentence = compact.match(/[^。！？.!?]+[。！？!?]?/u)?.[0]?.trim() ?? "";
  const maxLength = /[\p{Script=Han}]/u.test(firstSentence) ? 60 : 120;
  const normalized = clampText(firstSentence, maxLength);
  if (normalized && isUsableCommentary(normalized, title)) {
    return normalized;
  }
  return "";
}

function compactIntroSummary(value: string): string {
  return value
    .replace(/\r?\n+/g, " ")
    .replace(/^点评[:：]\s*/u, "")
    .replace(/[；;]+/g, "，")
    .trim();
}

function normalizeArticleBody(value: string): string {
  return normalizeParagraphs(
    value
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n")
  );
}

function looksLikeMojibake(value: string): boolean {
  const matches = value.match(/[锛銆鈥涓鍚鐨鏈寮缁璇鏄鏉浣甯绗鍙]/gu);
  return (matches?.length ?? 0) >= 2;
}

function isCommentaryTooSimilar(title: string, introSummary: string): boolean {
  const normalizedTitle = simplifyComparisonText(title);
  const normalizedSummary = simplifyComparisonText(introSummary);
  if (!normalizedTitle || !normalizedSummary) {
    return false;
  }
  return normalizedSummary === normalizedTitle
    || normalizedSummary.startsWith(normalizedTitle)
    || (normalizedTitle.startsWith(normalizedSummary) && normalizedSummary.length >= 12)
    || overlapRatio(normalizedTitle, normalizedSummary) >= 0.85;
}

function isUsableCommentary(introSummary: string, title: string): boolean {
  return /[\p{Script=Han}]/u.test(introSummary) && !isCommentaryTooSimilar(title, introSummary);
}

function simplifyComparisonText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”"'‘’《》【】（）()：:，,。.!！？?、~\-—_\s]/gu, "")
    .trim();
}

function overlapRatio(left: string, right: string): number {
  const leftTokens = comparisonTokens(left);
  const rightTokens = comparisonTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const rightSet = new Set(rightTokens);
  const hits = leftTokens.filter((token) => rightSet.has(token)).length;
  return hits / Math.min(leftTokens.length, rightTokens.length);
}

function comparisonTokens(value: string): string[] {
  const chunks = value.match(/[\p{Script=Han}]{1,2}|[a-z0-9]+/gu) ?? [];
  return chunks.filter(Boolean);
}

function preserveSourceLinks(item: NewsItem, proposedLinks: string[]): string[] {
  const links = new Map<string, string>();
  for (const link of [...proposedLinks, ...item.officialSources, item.sourceUrl]) {
    if (isValidHttpUrl(link)) {
      const canonical = canonicalizeUrl(link);
      if (!links.has(canonical)) {
        links.set(canonical, link);
      }
    }
  }
  return [...links.values()];
}

function hasPreservedSourceLink(item: NewsItem, sourceLinks: string[]): boolean {
  const allowedLinks = new Set(preserveSourceLinks(item, []).map(canonicalizeUrl));
  return sourceLinks.some((link) => isValidHttpUrl(link) && allowedLinks.has(canonicalizeUrl(link)));
}

function normalizeParagraphs(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => clampText(paragraph.trim(), 500))
    .filter(Boolean)
    .join("\n\n");
}

function claimsTraceToEvidence(item: NewsItem, entry: GeneratedArticleFields): boolean {
  const generatedText = `${entry.articleTitle} ${entry.articleBody} ${entry.introSummary}`;
  const claimTokens = tokenizeClaimText(generatedText);
  if (claimTokens.length === 0) {
    return /[\p{Script=Han}]/u.test(generatedText) && hasPreservedSourceLink(item, entry.sourceLinks);
  }

  const evidence = new Set(tokenizeEvidence([
    item.rawContent,
    item.summary,
    item.introSummary,
    item.sourceName,
    item.category,
    item.sourceUrl,
    item.officialSources.join(" "),
    item.keywords.join(" "),
    item.aiTags.join(" "),
    item.gameTags.join(" ")
  ].join(" ")));
  if (/[\p{Script=Han}]/u.test(generatedText) && hasPreservedSourceLink(item, entry.sourceLinks)) {
    return true;
  }
  const traced = claimTokens.filter((token) => evidence.has(token)).length;
  return traced / claimTokens.length >= 0.25;
}

function tokenizeClaimText(value: string): string[] {
  return tokenize(value).filter((token) => !stopwords.has(token) && token.length > 3 && !isCjkOnlyToken(token));
}

function tokenizeEvidence(value: string): string[] {
  return tokenize(value).filter((token) => !stopwords.has(token));
}

function tokenize(value: string): string[] {
  const tokens: string[] = [];
  
  // 1. CJK characters -> Bi-grams
  const cjkMatches = value.match(/[\p{Script=Han}]+/gu) ?? [];
  for (const match of cjkMatches) {
    if (match.length === 1) {
      tokens.push(match);
    } else {
      for (let i = 0; i < match.length - 1; i++) {
        tokens.push(match.slice(i, i + 2));
      }
    }
  }

  // 2. Non-CJK words
  const nonCjkMatches = value.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
  for (const match of nonCjkMatches) {
    tokens.push(stemToken(match));
  }

  return tokens;
}

function stemToken(value: string): string {
  return value.replace(/(?:ing|ed|es|s)$/u, "");
}

function isCjkOnlyToken(value: string): boolean {
  return /^[\p{Script=Han}]+$/u.test(value);
}

function firstContentLine(value: string): string {
  return value
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function clampText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
