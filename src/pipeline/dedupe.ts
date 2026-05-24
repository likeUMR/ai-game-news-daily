import { createHash } from "node:crypto";
import type { NewsItem, SourceType } from "./types.js";

export interface DedupeCandidate {
  id: string;
  sourceUrl: string;
  canonicalUrl?: string | null;
  contentHash?: string | null;
  articleTitle?: string | null;
  rawContent: string;
  publishedAt: string;
  collectedAt: string;
  sourceType: SourceType;
  sourceWeight: number;
  duplicateOf?: string | null;
}

export interface DuplicateMatch {
  duplicateOf: string | null;
  score: number;
  reason: "exact_url" | "exact_content" | "near_duplicate" | null;
}

const nearDuplicateThreshold = 0.66;

export function markDuplicateNewsItems(items: NewsItem[]): NewsItem[] {
  const processed = new Map<string, NewsItem>();

  for (const item of items) {
    const candidate = toCandidate(item);
    const match = findBestDuplicateMatch(candidate, Array.from(processed.values()).map(toCandidate));
    const matchedItem = match.duplicateOf ? processed.get(match.duplicateOf) : undefined;
    const preferred = matchedItem ? choosePreferredDedupeItem(candidate, toCandidate(matchedItem)) : candidate;

    const duplicateOf = normalizeDuplicateOf(match.duplicateOf ?? item.duplicateOf, item.id);

    if (duplicateOf && matchedItem && preferred.id === candidate.id) {
      const previous = matchedItem;
      processed.set(previous.id, { ...previous, duplicateOf: candidate.id, selected: false });
      for (const [id, processedItem] of processed) {
        if (processedItem.duplicateOf === previous.id) {
          processed.set(id, { ...processedItem, duplicateOf: candidate.id, selected: false });
        }
      }
      processed.set(item.id, { ...item, duplicateOf: null });
    } else {
      processed.set(item.id, { ...item, duplicateOf });
    }
  }

  return items.map((item) => processed.get(item.id)!);
}

function normalizeDuplicateOf(duplicateOf: string | null | undefined, itemId: string): string | null {
  if (!duplicateOf || duplicateOf === itemId) {
    return null;
  }
  return duplicateOf;
}

export function findBestDuplicateMatch(candidate: DedupeCandidate, recentItems: DedupeCandidate[]): DuplicateMatch {
  let best: DuplicateMatch = { duplicateOf: null, score: 0, reason: null };
  const candidateCanonicalUrl = candidate.canonicalUrl ?? canonicalizeUrl(candidate.sourceUrl);
  const candidateContentHash = candidate.contentHash ?? hashContentIfMeaningful(candidate.rawContent);

  for (const item of recentItems) {
    const itemCanonicalUrl = item.canonicalUrl ?? canonicalizeUrl(item.sourceUrl);
    const itemContentHash = item.contentHash ?? hashContentIfMeaningful(item.rawContent);
    const rootId = item.duplicateOf ?? item.id;

    if (candidateCanonicalUrl && itemCanonicalUrl && candidateCanonicalUrl === itemCanonicalUrl) {
      return { duplicateOf: rootId, score: 1, reason: "exact_url" };
    }

    if (candidateContentHash && itemContentHash && candidateContentHash === itemContentHash) {
      return { duplicateOf: rootId, score: 1, reason: "exact_content" };
    }

    const score = scoreContentSimilarity(candidate, item);
    if (score >= nearDuplicateThreshold && score > best.score) {
      best = { duplicateOf: rootId, score, reason: "near_duplicate" };
    }
  }

  return best;
}

export function choosePreferredDedupeItem(left: DedupeCandidate, right: DedupeCandidate): DedupeCandidate {
  const officialDelta = officialRank(right.sourceType) - officialRank(left.sourceType);
  if (officialDelta !== 0) {
    return officialDelta > 0 ? right : left;
  }

  const publishedDelta = Date.parse(left.publishedAt) - Date.parse(right.publishedAt);
  if (publishedDelta !== 0 && Number.isFinite(publishedDelta)) {
    return publishedDelta < 0 ? left : right;
  }

  if (left.sourceWeight !== right.sourceWeight) {
    return left.sourceWeight > right.sourceWeight ? left : right;
  }

  return left.collectedAt < right.collectedAt ? left : right;
}

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    const trackingParams = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "utm_id",
      "fbclid",
      "gclid",
      "mc_cid",
      "mc_eid"
    ]);

    for (const param of Array.from(parsed.searchParams.keys())) {
      if (trackingParams.has(param.toLowerCase())) {
        parsed.searchParams.delete(param);
      }
    }

    const sortedParams = Array.from(parsed.searchParams.entries()).sort(([left], [right]) => left.localeCompare(right));
    parsed.search = "";
    for (const [key, value] of sortedParams) {
      parsed.searchParams.append(key, value);
    }

    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return normalizeText(url);
  }
}

export function hashContent(content: string): string {
  return createHash("sha256").update(normalizeText(content)).digest("hex");
}

function hashContentIfMeaningful(content: string): string | null {
  const normalized = normalizeText(content);
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
}

export function normalizeTitle(title: string): string {
  return normalizeText(title)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(breaking|exclusive|update|report)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreContentSimilarity(left: DedupeCandidate, right: DedupeCandidate): number {
  const titleScore = jaccardSimilarity(tokenize(normalizeTitle(left.articleTitle ?? "")), tokenize(normalizeTitle(right.articleTitle ?? "")));
  const bodyScore = jaccardSimilarity(tokenize(normalizeText(left.rawContent)), tokenize(normalizeText(right.rawContent)));

  if (titleScore === 0 && bodyScore === 0) {
    return 0;
  }

  return Math.max(titleScore * 0.65 + bodyScore * 0.35, titleScore === 1 ? 0.78 : 0);
}

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function toCandidate(item: NewsItem): DedupeCandidate {
  return {
    id: item.id,
    sourceUrl: item.sourceUrl,
    articleTitle: item.articleTitle,
    rawContent: item.rawContent,
    publishedAt: item.publishedAt,
    collectedAt: item.collectedAt,
    sourceType: item.sourceType,
    sourceWeight: item.sourceWeight,
    duplicateOf: item.duplicateOf
  };
}

function officialRank(type: SourceType): number {
  return type === "official" ? 1 : 0;
}

function tokenize(value: string): Set<string> {
  const tokens = new Set<string>();
  
  // 1. 匹配汉字串，并切分为双字 Bi-gram（解决中文无空格、词长2字的问题）
  const cjkMatches = value.match(/[\p{Script=Han}]+/gu) ?? [];
  for (const match of cjkMatches) {
    if (match.length === 1) {
      tokens.add(match);
    } else {
      for (let i = 0; i < match.length - 1; i++) {
        tokens.add(match.slice(i, i + 2));
      }
    }
  }

  // 2. 匹配非汉字词（英文、数字等），过滤掉超短无意义词（length > 2）
  const nonCjkMatches = value.match(/[a-zA-Z0-9]+/gu) ?? [];
  for (const match of nonCjkMatches) {
    if (match.length > 2) {
      tokens.add(match.toLowerCase());
    }
  }

  return tokens;
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }

  return intersection / (left.size + right.size - intersection);
}
