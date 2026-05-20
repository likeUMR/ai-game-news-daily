import type { SourceDefinition } from "../config/sourceRegistry.js";
import type { CollectionResult, Collector, FetchLike, RawCollectedItem } from "./types.js";
import { normalizeCollectedUrl } from "./url.js";

export interface RssCollectorOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  maxItemsPerSource?: number;
}

export class RssCollector implements Collector {
  readonly name = "rss";
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxItemsPerSource: number;

  constructor(options: RssCollectorOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxItemsPerSource = options.maxItemsPerSource ?? 50;
  }

  async collect(sources: SourceDefinition[], now = new Date()): Promise<CollectionResult> {
    const items: RawCollectedItem[] = [];
    const failures: CollectionResult["failures"] = [];
    const rssSources = sources.filter((source) => ["rss", "rsshub"].includes(source.collection_strategy) && source.url);

    for (const source of rssSources) {
      try {
        const xml = await this.fetchText(source.url!, this.timeoutMs);
        items.push(...parseFeedXml(xml, source, now).slice(0, source.max_items_per_window ?? this.maxItemsPerSource));
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

  private async fetchText(url: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while fetching ${url}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function parseFeedXml(xml: string, source: SourceDefinition, now = new Date()): RawCollectedItem[] {
  const collectedAt = now.toISOString();
  const blocks = collectBlocks(xml, "item").length > 0 ? collectBlocks(xml, "item") : collectBlocks(xml, "entry");

  return blocks.flatMap((block) => {
    const title = cleanText(readTag(block, "title"));
    const link = readTag(block, "link") || readAtomLink(block);
    const normalizedUrl = link ? normalizeCollectedUrl(link, source.url) : null;
    if (!title || !normalizedUrl) {
      return [];
    }

    const excerpt = cleanText(readTag(block, "description") || readTag(block, "summary"));
    const rawContent = cleanText(readTag(block, "content:encoded") || readTag(block, "content") || excerpt || title);
    const publishedAt = parseDate(readTag(block, "pubDate") || readTag(block, "published") || readTag(block, "updated")) ?? collectedAt;
    const author = cleanText(readTag(block, "dc:creator") || readTag(block, "author") || readTag(block, "name")) || null;

    return [{
      title,
      url: normalizedUrl,
      source_name: source.name,
      source_type: source.source_type,
      published_at: publishedAt,
      collected_at: collectedAt,
      author,
      excerpt,
      raw_content: rawContent,
      metadata: {
        collector: "rss",
        source_id: source.id,
        source_url: source.url,
        original_url: link
      }
    }];
  });
}

function collectBlocks(xml: string, tag: string): string[] {
  return Array.from(xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi")), (match) => match[1] ?? "");
}

function readTag(block: string, tag: string): string {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  return match?.[1] ? decodeEntities(stripTags(stripCdata(match[1]))) : "";
}

function readAtomLink(block: string): string {
  const alternate = block.match(/<link\b(?=[^>]*\brel=["']alternate["'])([^>]*)\/?>/i)?.[1];
  const any = alternate ?? block.match(/<link\b([^>]*)\/?>/i)?.[1];
  return any?.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? "";
}

function stripCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
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

function parseDate(value: string): string | null {
  const timestamp = Date.parse(cleanText(value));
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}
