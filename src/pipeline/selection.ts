import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NewsItem } from "./types.js";

export interface SelectionOptions {
  generatedAt: string;
  dailyItemCount: number;
  categoryCounts: Record<string, number>;
  lowTrustSourceWeight: number;
  lowTrustHighScore: number;
  freshnessHours: number;
}

export interface SelectionEvidence {
  score: number;
  sourceWeight: number;
  freshnessHours: number | null;
  category: string;
  sourceUrl: string;
  officialSources: string[];
  duplicateGroup: string;
}

export interface AuditEntry {
  id: string;
  title: string;
  category: string;
  sourceName: string;
  sourceUrl: string;
  reasons: string[];
  evidence: SelectionEvidence;
}

export interface SelectionAudit {
  generatedAt: string;
  thresholds: SelectionOptions;
  selected: AuditEntry[];
  rejected: AuditEntry[];
  duplicate: AuditEntry[];
  failedVerification: AuditEntry[];
}

export interface SelectionResult {
  items: NewsItem[];
  audit: SelectionAudit;
}

interface VerificationResult {
  ok: boolean;
  reasons: string[];
}

const stopwords = new Set([
  "about", "across", "after", "again", "announced", "around", "article", "because", "before", "being",
  "between", "daily", "deeper", "during", "entry", "general", "industry", "into", "latest", "moves",
  "official", "practical", "reported", "report", "reports", "source", "their", "there", "these", "this",
  "through", "today", "update", "using", "with", "without", "workflows"
]);

export function parseCategoryCounts(value: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const chunk of value.split(",")) {
    const [rawCategory, rawCount] = chunk.split("=");
    const category = rawCategory?.trim();
    const count = Number.parseInt(rawCount?.trim() ?? "", 10);
    if (category && Number.isFinite(count) && count > 0) {
      counts[category] = count;
    }
  }
  return counts;
}

export function selectAndVerifyItems(items: NewsItem[], options: SelectionOptions): SelectionResult {
  const grouped = groupByDuplicateRoot(items);
  const duplicateEntries: AuditEntry[] = [];
  const failedVerification: AuditEntry[] = [];
  const rejected: AuditEntry[] = [];
  const eligible: NewsItem[] = [];

  for (const group of grouped.values()) {
    const canonical = chooseGroupWinner(group);
    const alternatives = collectOfficialSources(group, canonical);
    const candidate = {
      ...canonical,
      sourceUrl: chooseBestSourceUrl(canonical, alternatives),
      officialSources: alternatives
    };

    for (const duplicate of group.filter((item) => item.id !== canonical.id || item.duplicateOf !== null)) {
      duplicateEntries.push(toAuditEntry(duplicate, options, ["duplicate_of respected"]));
    }

    const verification = verifyItem(candidate, options);
    const verifiedCandidate = verification.ok
      ? candidate
      : buildEvidenceFallbackCandidate(candidate, verification.reasons);
    if (verifiedCandidate && candidate.isTopicCandidate) {
      eligible.push(verifiedCandidate);
    } else if (verification.ok && candidate.isTopicCandidate) {
      eligible.push(candidate);
    } else if (verification.ok) {
      rejected.push(toAuditEntry(candidate, options, [candidate.exclusionReason || "not a topic candidate"]));
    } else {
      failedVerification.push(toAuditEntry(candidate, options, verification.reasons));
    }
  }

  const selectedIds = new Set(selectBalanced(eligible, options).map((item) => item.id));
  const normalized = items.map((item) => {
    const selected = selectedIds.has(item.id);
    const selectedReplacement = selected ? eligible.find((candidate) => candidate.id === item.id) : undefined;
    if (selectedReplacement) {
      return { ...selectedReplacement, selected: true };
    }
    return { ...item, selected: false };
  });
  const selected = normalized.filter((item) => item.selected);
  const selectedSet = new Set(selected.map((item) => item.id));

  for (const item of eligible) {
    if (!selectedSet.has(item.id)) {
      rejected.push(toAuditEntry(item, options, ["eligible but outside configured daily count"]));
    }
  }

  const audit: SelectionAudit = {
    generatedAt: options.generatedAt,
    thresholds: options,
    selected: selected.map((item) => toAuditEntry(item, options, ["selected"])),
    rejected: sortAuditEntries(rejected),
    duplicate: sortAuditEntries(duplicateEntries),
    failedVerification: sortAuditEntries(failedVerification)
  };

  return { items: normalized, audit };
}

export async function writeSelectionAudit(outputDir: string, audit: SelectionAudit): Promise<string> {
  const auditDir = join(outputDir, "audit");
  await mkdir(auditDir, { recursive: true });
  const auditPath = join(auditDir, "editorial-selection-audit.json");
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  return auditPath;
}

function selectBalanced(items: NewsItem[], options: SelectionOptions): NewsItem[] {
  const selected = new Map<string, NewsItem>();
  const sorted = [...items].sort((left, right) => compareForSelection(left, right, options.generatedAt));

  for (const [category, count] of Object.entries(options.categoryCounts)) {
    const categoryItems = sorted.filter((item) => item.category === category && !selected.has(item.id));
    for (const item of categoryItems.slice(0, count)) {
      if (selected.size >= options.dailyItemCount) {
        break;
      }
      selected.set(item.id, item);
    }
  }

  for (const item of sorted) {
    if (selected.size >= options.dailyItemCount) {
      break;
    }
    selected.set(item.id, item);
  }

  return Array.from(selected.values()).sort((left, right) => compareForSelection(left, right, options.generatedAt));
}

function verifyItem(item: NewsItem, options: SelectionOptions): VerificationResult {
  const reasons: string[] = [];
  const generatedAt = Date.parse(options.generatedAt);
  const publishedAt = Date.parse(item.publishedAt);
  const ageHours = Number.isFinite(generatedAt) && Number.isFinite(publishedAt)
    ? (generatedAt - publishedAt) / 3_600_000
    : Number.NaN;

  if (!isValidHttpUrl(item.sourceUrl) && item.collectedAt.trim().length === 0) {
    reasons.push("source URL missing or was not collected successfully");
  }
  if (item.articleTitle.trim().length === 0) {
    reasons.push("article title is empty");
  }
  if (item.articleBody.trim().length === 0) {
    reasons.push("article body is empty");
  }
  if (!Number.isFinite(publishedAt) || ageHours < -6 || ageHours > options.freshnessHours) {
    reasons.push("published date is not plausible for the daily window");
  }
  if (item.sourceWeight < options.lowTrustSourceWeight && item.score < options.lowTrustHighScore) {
    reasons.push("low-trust source requires a high score");
  }
  if (item.duplicateOf !== null) {
    reasons.push("duplicate_of is set");
  }
  if (!claimsTraceToEvidence(item)) {
    reasons.push("generated claims do not trace to raw content, summary, or source metadata");
  }

  return { ok: reasons.length === 0, reasons };
}

function buildEvidenceFallbackCandidate(item: NewsItem, reasons: string[]): NewsItem | null {
  if (
    !item.isTopicCandidate
    || reasons.length !== 1
    || reasons[0] !== "generated claims do not trace to raw content, summary, or source metadata"
  ) {
    return null;
  }

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
    introSummary: clampText(summary, 80),
    articleBody: [
      `1. ${clampText(summary, 180)}`,
      `2. ${clampText(detail, 180)}`,
      `3. 来源：${item.sourceName}；这条候选已通过AI x 游戏相关性筛选，保守采用原始信息生成，避免发布未验证扩展判断。`
    ].join("\n")
  };
}

function claimsTraceToEvidence(item: NewsItem): boolean {
  const claimTokens = tokenizeClaimText(`${item.articleTitle} ${item.articleBody}`);
  if (claimTokens.length === 0) {
    return false;
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
  const traced = claimTokens.filter((token) => evidence.has(token)).length;
  return traced / claimTokens.length >= 0.5;
}

function isCjkToken(value: string): boolean {
  return /[\p{Script=Han}]/u.test(value);
}

function tokenizeClaimText(value: string): string[] {
  return tokenize(value).filter((token) => !stopwords.has(token) && (isCjkToken(token) || token.length > 3));
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

function firstContentLine(value: string): string {
  return value
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function clampText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function groupByDuplicateRoot(items: NewsItem[]): Map<string, NewsItem[]> {
  const groups = new Map<string, NewsItem[]>();
  const ids = new Set(items.map((item) => item.id));
  for (const item of items) {
    const root = item.duplicateOf && ids.has(item.duplicateOf) ? item.duplicateOf : item.id;
    groups.set(root, [...(groups.get(root) ?? []), item]);
  }
  return groups;
}

function chooseGroupWinner(items: NewsItem[]): NewsItem {
  const canonical = items.find((item) => item.duplicateOf === null);
  if (canonical) {
    return canonical;
  }
  return [...items].sort((left, right) => compareForSelection(left, right, right.collectedAt))[0]!;
}

function collectOfficialSources(items: NewsItem[], canonical: NewsItem): string[] {
  const urls = new Set<string>();
  for (const item of [canonical, ...items]) {
    if (item.sourceType === "official" && isValidHttpUrl(item.sourceUrl)) {
      urls.add(item.sourceUrl);
    }
    for (const source of item.officialSources) {
      if (isValidHttpUrl(source)) {
        urls.add(source);
      }
    }
  }
  if (urls.size === 0 && isValidHttpUrl(canonical.sourceUrl)) {
    urls.add(canonical.sourceUrl);
  }
  return [...urls];
}

function chooseBestSourceUrl(item: NewsItem, officialSources: string[]): string {
  if (item.sourceType === "official" && isValidHttpUrl(item.sourceUrl)) {
    return item.sourceUrl;
  }
  return officialSources[0] ?? item.sourceUrl;
}

function compareForSelection(left: NewsItem, right: NewsItem, generatedAt: string): number {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  const sourceWeightDelta = right.sourceWeight - left.sourceWeight;
  if (sourceWeightDelta !== 0) {
    return sourceWeightDelta;
  }
  return freshnessRank(left, generatedAt) - freshnessRank(right, generatedAt);
}

function freshnessRank(item: NewsItem, generatedAt: string): number {
  const generated = Date.parse(generatedAt);
  const published = Date.parse(item.publishedAt);
  if (!Number.isFinite(generated) || !Number.isFinite(published)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(generated - published);
}

function toAuditEntry(item: NewsItem, options: SelectionOptions, reasons: string[]): AuditEntry {
  return {
    id: item.id,
    title: item.articleTitle,
    category: item.category,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    reasons,
    evidence: {
      score: item.score,
      sourceWeight: item.sourceWeight,
      freshnessHours: calculateFreshnessHours(item, options.generatedAt),
      category: item.category,
      sourceUrl: item.sourceUrl,
      officialSources: item.officialSources,
      duplicateGroup: item.duplicateOf ?? item.id
    }
  };
}

function calculateFreshnessHours(item: NewsItem, generatedAt: string): number | null {
  const generated = Date.parse(generatedAt);
  const published = Date.parse(item.publishedAt);
  if (!Number.isFinite(generated) || !Number.isFinite(published)) {
    return null;
  }
  return Math.round(((generated - published) / 3_600_000) * 100) / 100;
}

function sortAuditEntries(entries: AuditEntry[]): AuditEntry[] {
  return [...entries].sort((left, right) => left.id.localeCompare(right.id));
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
