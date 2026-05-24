import type { SourceDefinition } from "../config/sourceRegistry.js";
import type { CollectionResult, Collector, FetchLike, RawCollectedItem } from "./types.js";
import { isSameOriginUrl, normalizeCollectedUrl } from "./url.js";
import { applyRulePrefilter } from "./rulePrefilter.js";

export interface WebPageCollectorOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  maxItemsPerSource?: number;
}

export class WebPageCollector implements Collector {
  readonly name = "web_page";
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxItemsPerSource: number;

  constructor(options: WebPageCollectorOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxItemsPerSource = options.maxItemsPerSource ?? 30;
  }

  async collect(sources: SourceDefinition[], now = new Date()): Promise<CollectionResult> {
    const items: RawCollectedItem[] = [];
    const failures: CollectionResult["failures"] = [];
    const webSources = sources.filter((source) => ["web_page", "official_site"].includes(source.collection_strategy) && source.url);

    for (const source of webSources) {
      try {
        if (source.id === "3dm") {
          items.push(...await this.collect3dmPages(source, now));
        } else {
          const html = await this.fetchHtml(source.url!, this.timeoutMs);
          items.push(...extractListingLinks(html, source, now).slice(0, source.max_items_per_window ?? this.maxItemsPerSource));
        }
      } catch (error) {
        failures.push({
          sourceId: source.id,
          sourceName: source.name,
          collector: this.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return { items, failures };
  }

  private async fetchHtml(url: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while fetching ${url}`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !contentType.includes("text/html")) {
        throw new Error(`Unsafe content type for webpage extraction: ${contentType}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async collect3dmPages(source: SourceDefinition, now: Date): Promise<RawCollectedItem[]> {
    const limit = source.max_items_per_window ?? this.maxItemsPerSource;
    const items: RawCollectedItem[] = [];
    const seen = new Set<string>();
    const maxPages = Math.max(1, Math.min(10, Math.ceil(limit / 20) + 1));

    for (let page = 1; page <= maxPages && items.length < limit; page += 1) {
      const html = await this.fetchHtml(create3dmPageUrl(source.url!, page), this.timeoutMs);
      const pageItems = extractListingLinks(html, source, now);
      if (pageItems.length === 0) {
        break;
      }
      for (const item of pageItems) {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          items.push(item);
        }
        if (items.length >= limit) {
          break;
        }
      }
    }

    return applyRulePrefilter(source.id, items, limit);
  }
}

function create3dmPageUrl(sourceUrl: string, page: number): string {
  const base = sourceUrl.match(/^(https:\/\/www\.3dmgame\.com\/news_all_)\d+\/?$/)?.[1] ?? "https://www.3dmgame.com/news_all_";
  return `${base}${page}/`;
}

export function extractListingLinks(html: string, source: SourceDefinition, now = new Date()): RawCollectedItem[] {
  if (!source.url) {
    return [];
  }

  const siteSpecificItems = extractSiteSpecificItems(html, source, now);
  if (siteSpecificItems.length > 0) {
    return siteSpecificItems;
  }

  const collectedAt = now.toISOString();
  const pageExcerpt = cleanText(readMeta(html, "description"));
  const seen = new Set<string>();
  const items: RawCollectedItem[] = [];

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] ?? "";
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const title = cleanText(stripTags(match[2] ?? ""));
    const url = href ? normalizeCollectedUrl(href, source.url) : null;

    if (!url || !title || title.length < 4 || seen.has(url) || !isSameOriginUrl(url, source.url)) {
      continue;
    }

    seen.add(url);
    items.push({
      title,
      url,
      source_name: source.name,
      source_type: source.source_type,
      published_at: collectedAt,
      collected_at: collectedAt,
      author: null,
      excerpt: pageExcerpt,
      raw_content: [title, pageExcerpt].filter(Boolean).join("\n\n"),
      metadata: {
        collector: "web_page",
        source_id: source.id,
        listing_url: source.url
      }
    });
  }

  return items;
}

function extractSiteSpecificItems(html: string, source: SourceDefinition, now: Date): RawCollectedItem[] {
  switch (source.id) {
    case "chuapp":
      return extractChuappDailyItems(html, source, now);
    case "gcores":
      return extractGcoresNewsItems(html, source, now);
    case "3dm":
      return extract3dmNewsItems(html, source, now);
    default:
      return [];
  }
}

function extractChuappDailyItems(html: string, source: SourceDefinition, now: Date): RawCollectedItem[] {
  const items: RawCollectedItem[] = [];
  const seen = new Set<string>();
  const collectedAt = now.toISOString();

  for (const match of html.matchAll(/<a class="fn-clear" href="([^"]+)"[\s\S]*?<dl class="fn-left">([\s\S]*?)<\/dl>\s*<\/a>/gi)) {
    const url = normalizeCollectedUrl(match[1] ?? "", source.url);
    const body = match[2] ?? "";
    const title = cleanText(body.match(/<dt>([\s\S]*?)<\/dt>/i)?.[1] ?? "");
    const excerpt = cleanText(body.match(/<dd>([\s\S]*?)<\/dd>\s*$/i)?.[1] ?? "");
    const author = cleanText(body.match(/<em>([\s\S]*?)<\/em>/i)?.[1] ?? "") || null;
    const timeText = cleanText(body.match(/<\/em>([^<]+)<\/span>/i)?.[1] ?? "");
    const publishedAt = parseChineseListingTime(timeText, now) ?? collectedAt;

    if (!url || !title || seen.has(url)) {
      continue;
    }

    seen.add(url);
    items.push(buildListingItem(source, title, url, excerpt, author, publishedAt, collectedAt));
  }

  return items;
}

function extractGcoresNewsItems(html: string, source: SourceDefinition, now: Date): RawCollectedItem[] {
  const items: RawCollectedItem[] = [];
  const seen = new Set<string>();
  const collectedAt = now.toISOString();

  for (const match of html.matchAll(/<a class="news" href="([^"]+)"[\s\S]*?<h3>([\s\S]*?)<\/h3>[\s\S]*?<div class="news_meta"><span class="me-3">([\s\S]*?)<\/span>/gi)) {
    const url = normalizeCollectedUrl(match[1] ?? "", source.url);
    const title = cleanText(match[2] ?? "");
    const timeText = cleanText(stripTags(match[3] ?? ""));
    const publishedAt = parseChineseListingTime(timeText, now) ?? collectedAt;

    if (!url || !title || seen.has(url)) {
      continue;
    }

    seen.add(url);
    items.push(buildListingItem(source, title, url, "", null, publishedAt, collectedAt));
  }

  return items;
}

function extract3dmNewsItems(html: string, source: SourceDefinition, now: Date): RawCollectedItem[] {
  const items: RawCollectedItem[] = [];
  const seen = new Set<string>();
  const collectedAt = now.toISOString();

  for (const match of html.matchAll(/<li class="selectpost">[\s\S]*?<a href="([^"]+)" target="_blank" class="bt">([\s\S]*?)<\/a>[\s\S]*?<span class="time">([\s\S]*?)<\/span>[\s\S]*?<div class="miaoshu">([\s\S]*?)<\/div>[\s\S]*?<\/li>/gi)) {
    const url = normalizeCollectedUrl(match[1] ?? "", source.url);
    const title = cleanText(match[2] ?? "");
    const timeText = cleanText(stripTags(match[3] ?? ""));
    const excerpt = cleanText(match[4] ?? "");
    const publishedAt = parseChineseListingTime(timeText, now) ?? collectedAt;

    if (!url || !title || seen.has(url)) {
      continue;
    }

    seen.add(url);
    items.push(buildListingItem(source, title, url, excerpt, null, publishedAt, collectedAt));
  }

  return items;
}

function buildListingItem(
  source: SourceDefinition,
  title: string,
  url: string,
  excerpt: string,
  author: string | null,
  publishedAt: string,
  collectedAt: string
): RawCollectedItem {
  return {
    title,
    url,
    source_name: source.name,
    source_type: source.source_type,
    published_at: publishedAt,
    collected_at: collectedAt,
    author,
    excerpt,
    raw_content: [title, excerpt].filter(Boolean).join("\n\n"),
    metadata: {
      collector: "web_page",
      source_id: source.id,
      listing_url: source.url
    }
  };
}

function parseChineseListingTime(value: string, now: Date): string | null {
  const text = value.trim();
  if (!text) {
    return null;
  }

  const relative = text.match(/^(\d+)\s*(分钟|小时|天)前$/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const deltaMs = unit === "分钟" ? amount * 60_000 : unit === "小时" ? amount * 3_600_000 : amount * 86_400_000;
    return new Date(now.getTime() - deltaMs).toISOString();
  }

  const monthDay = text.match(/^(\d{2})月(\d{2})日$/);
  if (monthDay) {
    const [, month, day] = monthDay;
    return chinaTimeToIso(`${now.getUTCFullYear()}-${month}-${day} 00:00:00`);
  }

  const fullDateTime = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)$/);
  if (fullDateTime) {
    return chinaTimeToIso(`${fullDateTime[1]} ${fullDateTime[2]}`);
  }

  return null;
}

function chinaTimeToIso(value: string): string | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second = "00"] = match;
  const utcMillis = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 8, Number(minute), Number(second));
  return new Date(utcMillis).toISOString();
}

function readMeta(html: string, name: string): string {
  const meta = html.match(new RegExp(`<meta\\b(?=[^>]*(?:name|property)=["']${name}["'])([^>]*)>`, "i"))?.[1];
  return meta?.match(/\bcontent=["']([^"']+)["']/i)?.[1] ?? "";
}

function stripTags(value: string): string {
  return value.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function cleanText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}
