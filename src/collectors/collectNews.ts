import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "../config/env.js";
import { getSourceRegistry, type SourceDefinition } from "../config/sourceRegistry.js";
import { canonicalizeUrl, hashContent, openNewsRepository, type NewsRepository } from "../db/newsRepository.js";
import { choosePreferredDedupeItem, findBestDuplicateMatch, type DedupeCandidate } from "../pipeline/dedupe.js";
import { DemoCollector } from "./demoCollector.js";
import { JsonApiCollector } from "./jsonApiCollector.js";
import { MarkdownCollector } from "./markdownCollector.js";
import { RssCollector } from "./rssCollector.js";
import type { CollectionResult, Collector, RawCollectedItem } from "./types.js";
import { WebPageCollector } from "./webPageCollector.js";

export interface PersistedCollectionResult extends CollectionResult {
  inserted: number;
  skippedDuplicates: number;
  markedDuplicates: number;
  sourceAudits: CollectionSourceAudit[];
  windowStart: string;
  windowEnd: string;
  limitedOut: number;
}

export interface CollectionSourceAudit {
  sourceId: string;
  sourceName: string;
  strategy: SourceDefinition["collection_strategy"];
  url: string | null;
  status: "ok" | "empty" | "partial_failure" | "failed" | "no_collector" | "no_url";
  fetched: number;
  persisted: number;
  skippedDuplicates: number;
  markedDuplicates: number;
  limitedOut: number;
  withinCollectionWindow: number;
  outsideCollectionWindow: number;
  newestPublishedAt: string | null;
  oldestPublishedAt: string | null;
  failures: string[];
  samples: Array<{
    title: string;
    url: string;
    publishedAt: string;
  }>;
}

export async function collectIntoSqlite(config: AppConfig): Promise<PersistedCollectionResult> {
  const sources = getSourceRegistry();
  const collectors: Collector[] = config.MOCK_MODE
    ? [new DemoCollector(), new MarkdownCollector({ manualDir: join(config.DATA_DIR, "manual") })]
    : [
        new RssCollector({ maxItemsPerSource: config.MAX_ITEMS_PER_SOURCE }),
        new JsonApiCollector({ maxItemsPerSource: config.MAX_ITEMS_PER_SOURCE }),
        new WebPageCollector({ maxItemsPerSource: config.MAX_ITEMS_PER_SOURCE }),
        new MarkdownCollector({ manualDir: join(config.DATA_DIR, "manual") })
      ];

  const repository = openNewsRepository(config.DATABASE_PATH);
  try {
    return await collectWithCollectors(
      repository,
      sources,
      collectors,
      new Date(),
      config.MAX_ITEMS_TOTAL,
      config.DEDUPE_WINDOW_HOURS,
      config.COLLECTION_WINDOW_HOURS
    );
  } finally {
    repository.close();
  }
}

export async function collectWithCollectors(
  repository: NewsRepository,
  sources: SourceDefinition[],
  collectors: Collector[],
  now = new Date(),
  maxItemsTotal = 500,
  dedupeWindowHours = 72,
  collectionWindowHours = 24
): Promise<PersistedCollectionResult> {
  const windowStart = new Date(now.getTime() - collectionWindowHours * 60 * 60 * 1000).toISOString();
  const windowEnd = now.toISOString();
  const sourceAudits = initializeSourceAudits(sources, collectors);
  const result: PersistedCollectionResult = {
    items: [],
    failures: [],
    inserted: 0,
    skippedDuplicates: 0,
    markedDuplicates: 0,
    sourceAudits,
    windowStart,
    windowEnd,
    limitedOut: 0
  };

  for (const collector of collectors) {
    const collected = await collector.collect(sources, now);
    result.failures.push(...collected.failures);
    result.items.push(...collected.items);
    for (const failure of collected.failures) {
      const audit = sourceAudits.find((item) => item.sourceId === failure.sourceId || item.sourceName === failure.sourceName);
      if (audit) {
        audit.failures.push(`${failure.collector}: ${failure.error}`);
      }
    }
    for (const item of collected.items) {
      recordFetchedItem(sourceAudits, sources, item, windowStart, windowEnd);
    }
  }

  const collectedAfter = new Date(now.getTime() - dedupeWindowHours * 60 * 60 * 1000).toISOString();
  const itemsToPersist = result.items.slice(0, maxItemsTotal);
  result.limitedOut = Math.max(0, result.items.length - itemsToPersist.length);

  for (const item of result.items.slice(0, maxItemsTotal)) {
    const persistResult = persistRawItem(repository, sources, item, collectedAfter);
    const audit = findAuditForRawItem(sourceAudits, sources, item);
    if (persistResult === "inserted") {
      result.inserted += 1;
      if (audit) {
        audit.persisted += 1;
      }
    } else if (persistResult === "duplicate") {
      result.inserted += 1;
      result.markedDuplicates += 1;
      if (audit) {
        audit.persisted += 1;
        audit.markedDuplicates += 1;
      }
    } else {
      result.skippedDuplicates += 1;
      if (audit) {
        audit.skippedDuplicates += 1;
      }
    }
  }

  for (const item of result.items.slice(maxItemsTotal)) {
    const audit = findAuditForRawItem(sourceAudits, sources, item);
    if (audit) {
      audit.limitedOut += 1;
    }
  }
  finalizeSourceAuditStatuses(sourceAudits);

  return result;
}

export async function writeCollectionAudit(outputDir: string, result: PersistedCollectionResult): Promise<string> {
  const auditDir = join(outputDir, "audit");
  await mkdir(auditDir, { recursive: true });
  const auditPath = join(auditDir, "collection-audit.json");
  await writeFile(auditPath, `${JSON.stringify({
    generatedAt: result.windowEnd,
    windowStart: result.windowStart,
    windowEnd: result.windowEnd,
    totals: {
      fetched: result.items.length,
      inserted: result.inserted,
      skippedDuplicates: result.skippedDuplicates,
      markedDuplicates: result.markedDuplicates,
      failures: result.failures.length,
      limitedOut: result.limitedOut
    },
    sources: result.sourceAudits
  }, null, 2)}\n`, "utf8");
  return auditPath;
}

type PersistRawResult = "inserted" | "duplicate" | "skipped";

const collectorStrategies: Record<SourceDefinition["collection_strategy"], string | null> = {
  rss: "rss",
  rsshub: "rss",
  web_page: "web_page",
  json_api: "json_api",
  x_social: null,
  manual_markdown: "manual_markdown",
  official_site: "web_page",
  community_submission: null
};

function initializeSourceAudits(sources: SourceDefinition[], collectors: Collector[]): CollectionSourceAudit[] {
  const collectorNames = new Set(collectors.map((collector) => collector.name));
  return sources.map((source) => {
    const expectedCollector = collectorStrategies[source.collection_strategy];
    const missingCollector = !expectedCollector || !collectorNames.has(expectedCollector);
    const missingUrl = source.collection_strategy !== "manual_markdown" && !source.url;
    return {
      sourceId: source.id,
      sourceName: source.name,
      strategy: source.collection_strategy,
      url: source.url ?? null,
      status: missingCollector ? "no_collector" : missingUrl ? "no_url" : "empty",
      fetched: 0,
      persisted: 0,
      skippedDuplicates: 0,
      markedDuplicates: 0,
      limitedOut: 0,
      withinCollectionWindow: 0,
      outsideCollectionWindow: 0,
      newestPublishedAt: null,
      oldestPublishedAt: null,
      failures: [],
      samples: []
    };
  });
}

function recordFetchedItem(
  sourceAudits: CollectionSourceAudit[],
  sources: SourceDefinition[],
  item: RawCollectedItem,
  windowStart: string,
  windowEnd: string
): void {
  const audit = findAuditForRawItem(sourceAudits, sources, item);
  if (!audit) {
    return;
  }
  audit.fetched += 1;
  if (audit.samples.length < 5) {
    audit.samples.push({
      title: item.title,
      url: item.url,
      publishedAt: item.published_at
    });
  }

  const publishedAt = Date.parse(item.published_at);
  if (Number.isFinite(publishedAt)) {
    const publishedIso = new Date(publishedAt).toISOString();
    if (!audit.newestPublishedAt || publishedIso > audit.newestPublishedAt) {
      audit.newestPublishedAt = publishedIso;
    }
    if (!audit.oldestPublishedAt || publishedIso < audit.oldestPublishedAt) {
      audit.oldestPublishedAt = publishedIso;
    }
    if (publishedIso >= windowStart && publishedIso <= windowEnd) {
      audit.withinCollectionWindow += 1;
    } else {
      audit.outsideCollectionWindow += 1;
    }
  } else {
    audit.outsideCollectionWindow += 1;
  }
}

function findAuditForRawItem(
  sourceAudits: CollectionSourceAudit[],
  sources: SourceDefinition[],
  item: RawCollectedItem
): CollectionSourceAudit | undefined {
  const source = sources.find((candidate) => candidate.name === item.source_name);
  return sourceAudits.find((audit) => audit.sourceId === source?.id || audit.sourceName === item.source_name);
}

function finalizeSourceAuditStatuses(sourceAudits: CollectionSourceAudit[]): void {
  for (const audit of sourceAudits) {
    if (audit.status === "no_collector" || audit.status === "no_url") {
      continue;
    }
    if (audit.failures.length > 0 && audit.fetched > 0) {
      audit.status = "partial_failure";
    } else if (audit.failures.length > 0) {
      audit.status = "failed";
    } else if (audit.fetched > 0) {
      audit.status = "ok";
    } else {
      audit.status = "empty";
    }
  }
}

function persistRawItem(repository: NewsRepository, sources: SourceDefinition[], item: RawCollectedItem, collectedAfter: string): PersistRawResult {
  const sourceDefinition = sources.find((source) => source.name === item.source_name);
  const source = repository.upsertSource({
    name: item.source_name,
    type: item.source_type,
    weight: sourceDefinition?.source_weight ?? 50,
    url: sourceDefinition?.url ?? null
  });
  const canonicalUrl = canonicalizeUrl(item.url);
  const contentHash = hashContent(item.raw_content);
  const existing = repository.findByCanonicalUrlOrContentHash(canonicalUrl, contentHash);

  if (existing) {
    return "skipped";
  }
  const candidate: DedupeCandidate = {
    id: item.url,
    sourceUrl: item.url,
    canonicalUrl,
    contentHash,
    articleTitle: item.title,
    rawContent: item.raw_content,
    publishedAt: item.published_at,
    collectedAt: item.collected_at,
    sourceType: item.source_type,
    sourceWeight: source.weight
  };
  const recentItems = repository.listRecentItemsForDedupe(200, collectedAfter);
  const match = findBestDuplicateMatch(candidate, recentItems);
  const duplicateOf = match.reason === "near_duplicate" ? match.duplicateOf : null;

  const inserted = repository.insertRawItem({
    sourceId: source.id,
    sourceUrl: item.url,
    rawContent: item.raw_content,
    publishedAt: item.published_at,
    collectedAt: item.collected_at,
    duplicateOf,
    metadata: {
      title: item.title,
      author: item.author,
      excerpt: item.excerpt,
      duplicate_score: match.score,
      duplicate_reason: match.reason,
      source_name: item.source_name,
      source_type: item.source_type,
      ...item.metadata
    }
  });

  if (duplicateOf) {
    const duplicateItem = recentItems.find((recent) => recent.id === duplicateOf);
    if (duplicateItem) {
      const preferred = choosePreferredDedupeItem({ ...candidate, id: inserted.id }, duplicateItem);
      if (preferred.id === inserted.id && duplicateItem.rawItemId) {
        repository.markRawItemDuplicate(duplicateItem.rawItemId, inserted.id);
        repository.markRawItemDuplicate(inserted.id, null);
      }
    }
  }

  return duplicateOf ? "duplicate" : "inserted";
}
