import type { SourceDefinition } from "../config/sourceRegistry.js";
import type { CollectionResult, Collector, FetchLike, RawCollectedItem } from "./types.js";
import { normalizeCollectedUrl } from "./url.js";

export interface JsonApiCollectorOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  maxItemsPerSource?: number;
}

interface JsonApiSourceAdapter {
  fetchItems(source: SourceDefinition, fetchImpl: FetchLike, timeoutMs: number, now: Date): Promise<RawCollectedItem[]>;
}

export class JsonApiCollector implements Collector {
  readonly name = "json_api";
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxItemsPerSource: number;

  constructor(options: JsonApiCollectorOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxItemsPerSource = options.maxItemsPerSource ?? 50;
  }

  async collect(sources: SourceDefinition[], now = new Date()): Promise<CollectionResult> {
    const items: RawCollectedItem[] = [];
    const failures: CollectionResult["failures"] = [];
    const jsonSources = sources.filter((source) => source.collection_strategy === "json_api");

    for (const source of jsonSources) {
      const adapter = sourceAdapters[source.id];
      if (!adapter) {
        failures.push({
          sourceId: source.id,
          sourceName: source.name,
          collector: this.name,
          error: `No json_api adapter configured for source ${source.id}`
        });
        continue;
      }

      try {
        const sourceItems = await adapter.fetchItems(source, this.fetchImpl, this.timeoutMs, now);
        items.push(...sourceItems.slice(0, source.max_items_per_window ?? this.maxItemsPerSource));
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
}

const sourceAdapters: Record<string, JsonApiSourceAdapter> = {
  youxituoluo: {
    async fetchItems(source, fetchImpl, timeoutMs, now) {
      const limit = source.max_items_per_window ?? 20;
      const payload = await fetchJson(`https://www.youxituoluo.com/api/post/list?page=1&limit=${limit}`, fetchImpl, timeoutMs);
      const records = readArray(payload, ["data", "data"]);
      const collectedAt = now.toISOString();

      return records.flatMap((record) => {
        const aid = numberLikeToString(record.aid);
        const title = cleanText(record.title);
        const url = aid ? normalizeCollectedUrl(`https://www.youxituoluo.com/${aid}.html`) : null;
        if (!title || !url) {
          return [];
        }

        const excerpt = cleanText(record.dis);
        return [{
          title,
          url,
          source_name: source.name,
          source_type: source.source_type,
          published_at: parseUnixTimestamp(record.sendtime) ?? collectedAt,
          collected_at: collectedAt,
          author: null,
          excerpt,
          raw_content: [title, excerpt].filter(Boolean).join("\n\n"),
          metadata: {
            collector: "json_api",
            source_id: source.id,
            source_url: source.url,
            api_url: "https://www.youxituoluo.com/api/post/list",
            original_aid: record.aid ?? null,
            slugs: Array.isArray(record.slugs) ? record.slugs : [],
            tags: extractYouxituoluoTags(record.tags)
          }
        }];
      });
    }
  },
  gamersky: {
    async fetchItems(source, fetchImpl, timeoutMs, now) {
      const apiUrl = "https://db2.gamersky.com/LabelJsonpAjax.aspx?jsondata=%7B%22type%22%3A%22updatenodelabel%22%2C%22nodeId%22%3A%2211007%22%2C%22isNodeId%22%3Atrue%2C%22page%22%3A1%7D";
      const text = await fetchText(apiUrl, fetchImpl, timeoutMs, {
        headers: {
          Referer: source.url ?? "https://www.gamersky.com/news/"
        }
      });
      const payload = parseJsonp(text);
      const body = typeof payload.body === "string" ? payload.body : "";

      return extractGamerskyItems(body, source, now.toISOString()).filter((item) =>
        isHighSignalItem(item.title, item.excerpt, "gamersky")
      );
    }
  }
};

async function fetchJson(url: string, fetchImpl: FetchLike, timeoutMs: number): Promise<unknown> {
  const text = await fetchText(url, fetchImpl, timeoutMs);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON response from ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function fetchText(url: string, fetchImpl: FetchLike, timeoutMs: number, init?: RequestInit): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while fetching ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function readArray(payload: unknown, path: string[]): Record<string, unknown>[] {
  let current = payload;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return [];
    }
    current = (current as Record<string, unknown>)[key];
  }

  return Array.isArray(current) ? current.filter(isRecord) : [];
}

function parseJsonp(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const match = trimmed.match(/^\(\s*(\{[\s\S]*\})\s*\)\s*;?\s*$/);
  if (!match?.[1]) {
    throw new Error("Invalid JSONP payload");
  }

  try {
    const parsed = JSON.parse(match[1]);
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`Invalid JSONP JSON payload: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function extractGamerskyItems(html: string, source: SourceDefinition, collectedAt: string): RawCollectedItem[] {
  const items: RawCollectedItem[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/<li>\s*([\s\S]*?)<\/li>/gi)) {
    const block = match[1] ?? "";
    const anchorMatch =
      block.match(/<a\b[^>]*class=["']tt["'][^>]*href=["']([^"']+)["'][^>]*title=["']([\s\S]*?)["'][^>]*>/i) ??
      block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*title=["']([\s\S]*?)["'][^>]*>/i);
    const rawUrl = anchorMatch?.[1];
    const title = cleanText(decodeEntities(anchorMatch?.[2] ?? ""));
    const url = rawUrl ? normalizeCollectedUrl(rawUrl, source.url) : null;

    if (!url || !title || seen.has(url)) {
      continue;
    }

    seen.add(url);
    const excerpt = cleanText(stripTags(block.match(/<div\b[^>]*class=["']txt["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ""));
    const publishedAt = parseGamerskyTime(block.match(/<div\b[^>]*class=["']time["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]) ?? collectedAt;

    items.push({
      title,
      url,
      source_name: source.name,
      source_type: source.source_type,
      published_at: publishedAt,
      collected_at: collectedAt,
      author: null,
      excerpt,
      raw_content: [title, excerpt].filter(Boolean).join("\n\n"),
      metadata: {
        collector: "json_api",
        source_id: source.id,
        source_url: source.url,
        api_url: "https://db2.gamersky.com/LabelJsonpAjax.aspx",
        transport: "jsonp"
      }
    });
  }

  return items;
}

function parseGamerskyTime(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = cleanText(value).replace(" ", "T") + "+08:00";
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function parseUnixTimestamp(value: unknown): string | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return new Date(numeric * 1000).toISOString();
}

function isHighSignalItem(title: string, excerpt: string, sourceId: string): boolean {
  const content = `${title} ${excerpt}`.toLowerCase();
  const hasAiSignal = /(ai|aigc|llm|agent|人工智能|大模型|智能体|生成式)/i.test(content);
  const hasIndustrySignal = /(游戏|厂商|工作室|研发|发行|上线|融资|合作|引擎|studio|engine|publishing|funding|partnership)/i.test(content);
  const hasNoiseSignal = /(老婆|主播|热议|相貌|血被|cos|写真|小姐姐|悲鸣|八卦|恋情)/i.test(content);

  if (sourceId === "gamersky") {
    return !hasNoiseSignal && (hasAiSignal || hasIndustrySignal);
  }

  return true;
}

function extractYouxituoluoTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((tag) => {
      if (typeof tag === "string") {
        return cleanText(tag);
      }
      if (isRecord(tag)) {
        return cleanText(tag.name);
      }
      return "";
    })
    .filter(Boolean);
}

function numberLikeToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return decodeEntities(stripTags(value)).replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, "…");
}
