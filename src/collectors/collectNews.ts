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
    return await collectWithCollectors(repository, sources, collectors, new Date(), config.MAX_ITEMS_TOTAL, config.DEDUPE_WINDOW_HOURS);
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
  dedupeWindowHours = 72
): Promise<PersistedCollectionResult> {
  const result: PersistedCollectionResult = {
    items: [],
    failures: [],
    inserted: 0,
    skippedDuplicates: 0,
    markedDuplicates: 0
  };

  for (const collector of collectors) {
    const collected = await collector.collect(sources, now);
    result.failures.push(...collected.failures);
    result.items.push(...collected.items);
  }

  const collectedAfter = new Date(now.getTime() - dedupeWindowHours * 60 * 60 * 1000).toISOString();

  for (const item of result.items.slice(0, maxItemsTotal)) {
    const persistResult = persistRawItem(repository, sources, item, collectedAfter);
    if (persistResult === "inserted") {
      result.inserted += 1;
    } else if (persistResult === "duplicate") {
      result.inserted += 1;
      result.markedDuplicates += 1;
    } else {
      result.skippedDuplicates += 1;
    }
  }

  return result;
}

type PersistRawResult = "inserted" | "duplicate" | "skipped";

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
