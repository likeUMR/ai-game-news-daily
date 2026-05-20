import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { canonicalizeUrl, hashContent } from "../pipeline/dedupe.js";
import type { NewsItem, SourceType } from "../pipeline/types.js";

export { canonicalizeUrl, hashContent };

type JsonValue = string[] | NewsItem["ttsSegments"] | NewsItem["timeline"];

export interface SourceInput {
  name: string;
  type: SourceType;
  weight: number;
  url?: string | null;
}

export interface SourceRecord extends SourceInput {
  id: string;
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RawItemInput {
  id?: string;
  sourceId: string;
  sourceUrl: string;
  rawContent: string;
  publishedAt: string;
  collectedAt: string;
  duplicateOf?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RawItemRecord extends Required<Omit<RawItemInput, "id" | "metadata" | "duplicateOf">> {
  id: string;
  canonicalUrl: string;
  contentHash: string;
  duplicateOf: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface GeneratedOutputInput {
  id?: string;
  runId: string;
  itemId?: string | null;
  outputType: string;
  outputPath?: string | null;
  content?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProcessingAuditInput {
  rawItemId: string;
  processedItemId?: string | null;
  stage: string;
  status: "processed" | "excluded" | "error";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ProcessingAuditRecord extends Required<Omit<ProcessingAuditInput, "processedItemId" | "metadata">> {
  id: string;
  processedItemId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PipelineRunInput {
  id?: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  completedAt?: string | null;
  config?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string | null;
}

export interface PipelineRunRecord extends Required<Omit<PipelineRunInput, "id" | "completedAt" | "config" | "result" | "error">> {
  id: string;
  completedAt: string | null;
  config: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedOutputRecord extends Required<Omit<GeneratedOutputInput, "id" | "itemId" | "outputPath" | "content" | "metadata">> {
  id: string;
  itemId: string | null;
  outputPath: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DedupeItem {
  id: string;
  rawItemId: string | null;
  sourceUrl: string;
  canonicalUrl: string | null;
  contentHash: string | null;
  articleTitle: string;
  rawContent: string;
  publishedAt: string;
  collectedAt: string;
  sourceType: SourceType;
  sourceWeight: number;
  duplicateOf: string | null;
}

export interface PendingRawItem {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  sourceWeight: number;
  sourceUrl: string;
  rawContent: string;
  publishedAt: string;
  collectedAt: string;
  duplicateOf: string | null;
  metadata: Record<string, unknown>;
}

export class NewsRepository {
  constructor(private readonly db: Database.Database) {}

  close(): void {
    this.db.close();
  }

  upsertSource(input: SourceInput): SourceRecord {
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT id, created_at FROM sources WHERE name = ?").get(input.name) as Pick<SourceRow, "id" | "created_at"> | undefined;
    const id = existing?.id ?? randomUUID();
    const createdAt = existing?.created_at ?? now;

    this.db.prepare(`
      INSERT INTO sources (id, name, type, weight, url, created_at, updated_at)
      VALUES (@id, @name, @type, @weight, @url, @createdAt, @updatedAt)
      ON CONFLICT(name) DO UPDATE SET
        type = excluded.type,
        weight = excluded.weight,
        url = excluded.url,
        updated_at = excluded.updated_at
    `).run({
      id,
      name: input.name,
      type: input.type,
      weight: input.weight,
      url: input.url ?? null,
      createdAt,
      updatedAt: now
    });

    return this.getSourceById(id);
  }

  insertRawItem(input: RawItemInput): RawItemRecord {
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const canonicalUrl = canonicalizeUrl(input.sourceUrl);
    const contentHash = hashContent(input.rawContent);

    this.db.prepare(`
      INSERT INTO raw_items (
        id, source_id, source_url, canonical_url, content_hash, raw_content,
        published_at, collected_at, duplicate_of, metadata, created_at
      )
      VALUES (
        @id, @sourceId, @sourceUrl, @canonicalUrl, @contentHash, @rawContent,
        @publishedAt, @collectedAt, @duplicateOf, @metadata, @createdAt
      )
    `).run({
      id,
      sourceId: input.sourceId,
      sourceUrl: input.sourceUrl,
      canonicalUrl,
      contentHash,
      rawContent: input.rawContent,
      publishedAt: input.publishedAt,
      collectedAt: input.collectedAt,
      duplicateOf: input.duplicateOf ?? null,
      metadata: stringifyJson(input.metadata ?? {}),
      createdAt: now
    });

    return this.getRawItemById(id);
  }

  findByCanonicalUrlOrContentHash(canonicalUrl: string, contentHash: string): RawItemRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM raw_items
      WHERE canonical_url = @canonicalUrl OR content_hash = @contentHash
      ORDER BY collected_at DESC
      LIMIT 1
    `).get({ canonicalUrl, contentHash }) as RawItemRow | undefined;

    return row ? mapRawItem(row) : null;
  }

  listRecentItemsForDedupe(limit = 100, collectedAfter?: string): DedupeItem[] {
    const processedWhere = collectedAfter ? "WHERE COALESCE(p.collected_at, r.collected_at) >= @collectedAfter" : "";
    const processedRows = this.db.prepare(`
      SELECT
        p.id,
        p.raw_item_id,
        p.source_url,
        r.canonical_url,
        r.content_hash,
        p.article_title,
        p.raw_content,
        p.published_at,
        p.collected_at,
        p.source_type,
        p.source_weight,
        p.duplicate_of
      FROM processed_items p
      LEFT JOIN raw_items r ON r.id = p.raw_item_id
      ${processedWhere}
      ORDER BY p.collected_at DESC
      LIMIT @limit
    `).all({ limit, collectedAfter }) as DedupeRow[];

    const rawWhere = collectedAfter ? "WHERE r.collected_at >= @collectedAfter" : "";
    const rawRows = this.db.prepare(`
      SELECT
        r.id,
        r.id AS raw_item_id,
        r.source_url,
        r.canonical_url,
        r.content_hash,
        r.raw_content,
        r.published_at,
        r.collected_at,
        r.duplicate_of,
        r.metadata,
        s.type AS source_type,
        s.weight AS source_weight
      FROM raw_items r
      JOIN sources s ON s.id = r.source_id
      ${rawWhere}
      ORDER BY r.collected_at DESC
      LIMIT @limit
    `).all({ limit, collectedAfter }) as RawDedupeRow[];

    const processedItems = processedRows.map((row) => ({
      id: row.id,
      rawItemId: row.raw_item_id,
      sourceUrl: row.source_url,
      canonicalUrl: row.canonical_url,
      contentHash: row.content_hash,
      articleTitle: row.article_title,
      rawContent: row.raw_content,
      publishedAt: row.published_at,
      collectedAt: row.collected_at,
      sourceType: row.source_type as SourceType,
      sourceWeight: row.source_weight,
      duplicateOf: row.duplicate_of
    }));
    const processedRawIds = new Set(processedItems.map((item) => item.rawItemId).filter(Boolean));
    const rawItems = rawRows
      .filter((row) => !processedRawIds.has(row.raw_item_id))
      .map((row) => ({
        id: row.id,
        rawItemId: row.raw_item_id,
        sourceUrl: row.source_url,
        canonicalUrl: row.canonical_url,
        contentHash: row.content_hash,
        articleTitle: readMetadataTitle(row.metadata),
        rawContent: row.raw_content,
        publishedAt: row.published_at,
        collectedAt: row.collected_at,
        sourceType: row.source_type as SourceType,
        sourceWeight: row.source_weight,
        duplicateOf: row.duplicate_of
      }));

    return [...processedItems, ...rawItems]
      .sort((left, right) => right.collectedAt.localeCompare(left.collectedAt))
      .slice(0, limit);
  }

  markRawItemDuplicate(id: string, duplicateOf: string | null): void {
    this.db.prepare("UPDATE raw_items SET duplicate_of = ? WHERE id = ?").run(duplicateOf, id);
  }

  listPendingRawItems(limit = 500): PendingRawItem[] {
    const rows = this.db.prepare(`
      SELECT
        r.id,
        r.source_id,
        s.name AS source_name,
        s.type AS source_type,
        s.weight AS source_weight,
        r.source_url,
        r.raw_content,
        r.published_at,
        r.collected_at,
        r.duplicate_of,
        r.metadata
      FROM raw_items r
      JOIN sources s ON s.id = r.source_id
      LEFT JOIN processed_items p ON p.raw_item_id = r.id
      WHERE p.id IS NULL
      ORDER BY r.collected_at ASC
      LIMIT @limit
    `).all({ limit }) as PendingRawItemRow[];

    return rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      sourceName: row.source_name,
      sourceType: row.source_type as SourceType,
      sourceWeight: row.source_weight,
      sourceUrl: row.source_url,
      rawContent: row.raw_content,
      publishedAt: row.published_at,
      collectedAt: row.collected_at,
      duplicateOf: row.duplicate_of,
      metadata: parseJsonObject(row.metadata)
    }));
  }

  findProcessedItemIdByRawItemId(rawItemId: string): string | null {
    const row = this.db.prepare("SELECT id FROM processed_items WHERE raw_item_id = ? LIMIT 1").get(rawItemId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  listTopicCandidates(limit = 500, minCrossRelevanceScore = 0): NewsItem[] {
    const rows = this.db.prepare(`
      SELECT * FROM processed_items
      WHERE is_topic_candidate = 1
        AND cross_relevance_score >= @minCrossRelevanceScore
      ORDER BY score DESC, source_weight DESC, published_at DESC
      LIMIT @limit
    `).all({ limit, minCrossRelevanceScore }) as ProcessedItemRow[];

    return rows.map(mapProcessedItem);
  }

  saveProcessedFields(item: Partial<NewsItem> & Pick<NewsItem, "id"> & { rawItemId?: string | null }): NewsItem {
    const current = this.getProcessedItem(item.id);
    const next = toPersistedNewsItem({ ...defaultNewsItem(item.id), ...current, ...item });
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO processed_items (
        id, raw_item_id, source_url, source_name, source_type, source_weight,
        published_at, collected_at, raw_content, summary, keywords, category,
        score, news_value_score, duplicate_of, selected, official_sources, article_title,
        article_body, intro_summary, assets, script_segments, tts_segments,
        timeline, subtitle_srt, ai_relevance_score, game_relevance_score,
        cross_relevance_score, ai_tags, game_tags, is_topic_candidate,
        exclusion_reason, created_at, updated_at
      )
      VALUES (
        @id, @rawItemId, @sourceUrl, @sourceName, @sourceType, @sourceWeight,
        @publishedAt, @collectedAt, @rawContent, @summary, @keywords, @category,
        @score, @newsValueScore, @duplicateOf, @selected, @officialSources, @articleTitle,
        @articleBody, @introSummary, @assets, @scriptSegments, @ttsSegments,
        @timeline, @subtitleSrt, @aiRelevanceScore, @gameRelevanceScore,
        @crossRelevanceScore, @aiTags, @gameTags, @isTopicCandidate,
        @exclusionReason, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        raw_item_id = excluded.raw_item_id,
        source_url = excluded.source_url,
        source_name = excluded.source_name,
        source_type = excluded.source_type,
        source_weight = excluded.source_weight,
        published_at = excluded.published_at,
        collected_at = excluded.collected_at,
        raw_content = excluded.raw_content,
        summary = excluded.summary,
        keywords = excluded.keywords,
        category = excluded.category,
        score = excluded.score,
        news_value_score = excluded.news_value_score,
        duplicate_of = excluded.duplicate_of,
        selected = excluded.selected,
        official_sources = excluded.official_sources,
        article_title = excluded.article_title,
        article_body = excluded.article_body,
        intro_summary = excluded.intro_summary,
        assets = excluded.assets,
        script_segments = excluded.script_segments,
        tts_segments = excluded.tts_segments,
        timeline = excluded.timeline,
        subtitle_srt = excluded.subtitle_srt,
        ai_relevance_score = excluded.ai_relevance_score,
        game_relevance_score = excluded.game_relevance_score,
        cross_relevance_score = excluded.cross_relevance_score,
        ai_tags = excluded.ai_tags,
        game_tags = excluded.game_tags,
        is_topic_candidate = excluded.is_topic_candidate,
        exclusion_reason = excluded.exclusion_reason,
        updated_at = excluded.updated_at
    `).run({
      ...next,
      rawItemId: item.rawItemId ?? null,
      keywords: stringifyJson(next.keywords),
      selected: boolToInt(next.selected),
      officialSources: stringifyJson(next.officialSources),
      assets: stringifyJson(next.assets),
      scriptSegments: stringifyJson(next.scriptSegments),
      ttsSegments: stringifyJson(next.ttsSegments),
      timeline: stringifyJson(next.timeline),
      aiTags: stringifyJson(next.aiTags),
      gameTags: stringifyJson(next.gameTags),
      isTopicCandidate: boolToInt(next.isTopicCandidate),
      createdAt: now,
      updatedAt: now
    });

    return this.getProcessedItem(item.id) ?? next;
  }

  saveProcessingAudit(input: ProcessingAuditInput): ProcessingAuditRecord {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO processing_audit_logs (
        id, raw_item_id, processed_item_id, stage, status, message, metadata, created_at
      )
      VALUES (
        @id, @rawItemId, @processedItemId, @stage, @status, @message, @metadata, @createdAt
      )
    `).run({
      id,
      rawItemId: input.rawItemId,
      processedItemId: input.processedItemId ?? null,
      stage: input.stage,
      status: input.status,
      message: input.message,
      metadata: stringifyJson(input.metadata ?? {}),
      createdAt
    });

    const row = this.db.prepare("SELECT * FROM processing_audit_logs WHERE id = ?").get(id) as ProcessingAuditRow;
    return mapProcessingAudit(row);
  }

  listProcessingAuditLogs(rawItemId?: string): ProcessingAuditRecord[] {
    const rows = rawItemId
      ? this.db.prepare("SELECT * FROM processing_audit_logs WHERE raw_item_id = ? ORDER BY created_at ASC").all(rawItemId) as ProcessingAuditRow[]
      : this.db.prepare("SELECT * FROM processing_audit_logs ORDER BY created_at ASC").all() as ProcessingAuditRow[];

    return rows.map(mapProcessingAudit);
  }

  selectCandidates(limit: number, minCrossRelevanceScore = 0): NewsItem[] {
    const rows = this.db.prepare(`
      SELECT * FROM processed_items
      WHERE selected = 1
        AND is_topic_candidate = 1
        AND duplicate_of IS NULL
        AND cross_relevance_score >= @minCrossRelevanceScore
      ORDER BY score DESC, source_weight DESC, published_at DESC
      LIMIT @limit
    `).all({ limit, minCrossRelevanceScore }) as ProcessedItemRow[];

    return rows.map(mapProcessedItem);
  }

  listWeeklyCandidates(startDate: string, endDate: string, limit = 9): NewsItem[] {
    const rows = this.db.prepare(`
      SELECT * FROM processed_items
      WHERE selected = 1
        AND duplicate_of IS NULL
        AND (
          (published_at >= @startDate AND published_at <= @endDate)
          OR
          (collected_at >= @startDate AND collected_at <= @endDate)
        )
      ORDER BY score DESC, source_weight DESC, published_at DESC
      LIMIT @limit
    `).all({ startDate, endDate, limit }) as ProcessedItemRow[];

    return rows.map(mapProcessedItem);
  }

  savePipelineRun(input: PipelineRunInput): PipelineRunRecord {
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO pipeline_runs (
        id, status, started_at, completed_at, config, result, error, created_at, updated_at
      )
      VALUES (
        @id, @status, @startedAt, @completedAt, @config, @result, @error, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        completed_at = excluded.completed_at,
        config = excluded.config,
        result = excluded.result,
        error = excluded.error,
        updated_at = excluded.updated_at
    `).run({
      id,
      status: input.status,
      startedAt: input.startedAt,
      completedAt: input.completedAt ?? null,
      config: stringifyJson(input.config ?? {}),
      result: stringifyJson(input.result ?? {}),
      error: input.error ?? null,
      createdAt: now,
      updatedAt: now
    });

    const row = this.db.prepare("SELECT * FROM pipeline_runs WHERE id = ?").get(id) as PipelineRunRow;
    return mapPipelineRun(row);
  }

  saveGeneratedOutput(input: GeneratedOutputInput): GeneratedOutputRecord {
    const id = input.id ?? randomUUID();
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO generated_outputs (
        id, run_id, item_id, output_type, output_path, content, metadata, created_at
      )
      VALUES (
        @id, @runId, @itemId, @outputType, @outputPath, @content, @metadata, @createdAt
      )
    `).run({
      id,
      runId: input.runId,
      itemId: input.itemId ?? null,
      outputType: input.outputType,
      outputPath: input.outputPath ?? null,
      content: input.content ?? null,
      metadata: stringifyJson(input.metadata ?? {}),
      createdAt
    });

    const row = this.db.prepare("SELECT * FROM generated_outputs WHERE id = ?").get(id) as GeneratedOutputRow;
    return mapGeneratedOutput(row);
  }

  listGeneratedOutputs(runId?: string): GeneratedOutputRecord[] {
    const rows = runId
      ? this.db.prepare("SELECT * FROM generated_outputs WHERE run_id = ? ORDER BY created_at ASC").all(runId) as GeneratedOutputRow[]
      : this.db.prepare("SELECT * FROM generated_outputs ORDER BY created_at ASC").all() as GeneratedOutputRow[];

    return rows.map(mapGeneratedOutput);
  }

  getProcessedItem(id: string): NewsItem | null {
    const row = this.db.prepare("SELECT * FROM processed_items WHERE id = ?").get(id) as ProcessedItemRow | undefined;
    return row ? mapProcessedItem(row) : null;
  }

  private getSourceById(id: string): SourceRecord {
    const row = this.db.prepare("SELECT * FROM sources WHERE id = ?").get(id) as SourceRow | undefined;
    if (!row) {
      throw new Error(`Source not found after upsert: ${id}`);
    }

    return {
      id: row.id,
      name: row.name,
      type: row.type as SourceType,
      weight: row.weight,
      url: row.url,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private getRawItemById(id: string): RawItemRecord {
    const row = this.db.prepare("SELECT * FROM raw_items WHERE id = ?").get(id) as RawItemRow | undefined;
    if (!row) {
      throw new Error(`Raw item not found after insert: ${id}`);
    }

    return mapRawItem(row);
  }
}

export function openNewsRepository(databasePath = "data/news.sqlite"): NewsRepository {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  initializeDatabase(db);
  return new NewsRepository(db);
}

export function initializeDatabase(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0,
      url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id),
      source_url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      raw_content TEXT NOT NULL,
      published_at TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      duplicate_of TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_raw_items_canonical_url ON raw_items(canonical_url);
    CREATE INDEX IF NOT EXISTS idx_raw_items_content_hash ON raw_items(content_hash);
    CREATE INDEX IF NOT EXISTS idx_raw_items_collected_at ON raw_items(collected_at);

    CREATE TABLE IF NOT EXISTS processed_items (
      id TEXT PRIMARY KEY,
      raw_item_id TEXT REFERENCES raw_items(id),
      source_url TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_weight REAL NOT NULL DEFAULT 0,
      published_at TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      raw_content TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      keywords TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL DEFAULT '',
      score REAL NOT NULL DEFAULT 0,
      news_value_score REAL NOT NULL DEFAULT 0,
      duplicate_of TEXT REFERENCES processed_items(id),
      selected INTEGER NOT NULL DEFAULT 0,
      official_sources TEXT NOT NULL DEFAULT '[]',
      article_title TEXT NOT NULL DEFAULT '',
      article_body TEXT NOT NULL DEFAULT '',
      intro_summary TEXT NOT NULL DEFAULT '',
      assets TEXT NOT NULL DEFAULT '[]',
      script_segments TEXT NOT NULL DEFAULT '[]',
      tts_segments TEXT NOT NULL DEFAULT '[]',
      timeline TEXT NOT NULL DEFAULT '[]',
      subtitle_srt TEXT NOT NULL DEFAULT '',
      ai_relevance_score REAL NOT NULL DEFAULT 0,
      game_relevance_score REAL NOT NULL DEFAULT 0,
      cross_relevance_score REAL NOT NULL DEFAULT 0,
      ai_tags TEXT NOT NULL DEFAULT '[]',
      game_tags TEXT NOT NULL DEFAULT '[]',
      is_topic_candidate INTEGER NOT NULL DEFAULT 0,
      exclusion_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_processed_items_candidate ON processed_items(selected, is_topic_candidate, cross_relevance_score);
    CREATE INDEX IF NOT EXISTS idx_processed_items_collected_at ON processed_items(collected_at);

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      result TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generated_outputs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
      item_id TEXT REFERENCES processed_items(id),
      output_type TEXT NOT NULL,
      output_path TEXT,
      content TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_generated_outputs_run_id ON generated_outputs(run_id);

    CREATE TABLE IF NOT EXISTS processing_audit_logs (
      id TEXT PRIMARY KEY,
      raw_item_id TEXT NOT NULL REFERENCES raw_items(id),
      processed_item_id TEXT REFERENCES processed_items(id),
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_processing_audit_logs_raw_item_id ON processing_audit_logs(raw_item_id);

    CREATE TABLE IF NOT EXISTS asset_records (
      id TEXT PRIMARY KEY,
      item_id TEXT REFERENCES processed_items(id),
      output_id TEXT REFERENCES generated_outputs(id),
      asset_type TEXT NOT NULL,
      uri TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);

  addColumnIfMissing(db, "raw_items", "duplicate_of", "TEXT");
  addColumnIfMissing(db, "processed_items", "news_value_score", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "processed_items", "exclusion_reason", "TEXT NOT NULL DEFAULT ''");

  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (1, 'initial_news_repository_schema', ?)
  `).run(new Date().toISOString());
}

function defaultNewsItem(id: string): NewsItem {
  const now = new Date(0).toISOString();

  return {
    id,
    sourceUrl: "",
    sourceName: "",
    sourceType: "community",
    sourceWeight: 0,
    publishedAt: now,
    collectedAt: now,
    rawContent: "",
    summary: "",
    keywords: [],
      category: "",
      score: 0,
      newsValueScore: 0,
      duplicateOf: null,
    selected: false,
    officialSources: [],
    articleTitle: "",
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

function toPersistedNewsItem(item: NewsItem): NewsItem {
  return {
    ...item,
    duplicateOf: item.duplicateOf ?? null,
    keywords: item.keywords ?? [],
    officialSources: item.officialSources ?? [],
    assets: item.assets ?? [],
    scriptSegments: item.scriptSegments ?? [],
    ttsSegments: item.ttsSegments ?? [],
    timeline: item.timeline ?? [],
    aiTags: item.aiTags ?? [],
    gameTags: item.gameTags ?? []
  };
}

function mapRawItem(row: RawItemRow): RawItemRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceUrl: row.source_url,
    canonicalUrl: row.canonical_url,
    contentHash: row.content_hash,
    rawContent: row.raw_content,
    publishedAt: row.published_at,
    collectedAt: row.collected_at,
    duplicateOf: row.duplicate_of,
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at
  };
}

function mapProcessedItem(row: ProcessedItemRow): NewsItem {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    sourceName: row.source_name,
    sourceType: row.source_type as SourceType,
    sourceWeight: row.source_weight,
    publishedAt: row.published_at,
    collectedAt: row.collected_at,
    rawContent: row.raw_content,
    summary: row.summary,
    keywords: parseJson(row.keywords, []),
    category: row.category,
    score: row.score,
    newsValueScore: row.news_value_score,
    duplicateOf: row.duplicate_of,
    selected: intToBool(row.selected),
    officialSources: parseJson(row.official_sources, []),
    articleTitle: row.article_title,
    articleBody: row.article_body,
    introSummary: row.intro_summary,
    assets: parseJson(row.assets, []),
    scriptSegments: parseJson(row.script_segments, []),
    ttsSegments: parseJson(row.tts_segments, []),
    timeline: parseJson(row.timeline, []),
    subtitleSrt: row.subtitle_srt,
    aiRelevanceScore: row.ai_relevance_score,
    gameRelevanceScore: row.game_relevance_score,
    crossRelevanceScore: row.cross_relevance_score,
    aiTags: parseJson(row.ai_tags, []),
    gameTags: parseJson(row.game_tags, []),
    isTopicCandidate: intToBool(row.is_topic_candidate),
    exclusionReason: row.exclusion_reason
  };
}

function mapGeneratedOutput(row: GeneratedOutputRow): GeneratedOutputRecord {
  return {
    id: row.id,
    runId: row.run_id,
    itemId: row.item_id,
    outputType: row.output_type,
    outputPath: row.output_path,
    content: row.content,
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at
  };
}

function mapPipelineRun(row: PipelineRunRow): PipelineRunRecord {
  return {
    id: row.id,
    status: row.status as PipelineRunRecord["status"],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    config: parseJsonObject(row.config),
    result: parseJsonObject(row.result),
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProcessingAudit(row: ProcessingAuditRow): ProcessingAuditRecord {
  return {
    id: row.id,
    rawItemId: row.raw_item_id,
    processedItemId: row.processed_item_id,
    stage: row.stage,
    status: row.status as ProcessingAuditRecord["status"],
    message: row.message,
    metadata: parseJsonObject(row.metadata),
    createdAt: row.created_at
  };
}

function stringifyJson(value: JsonValue | Record<string, unknown>): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(value, {});
}

function boolToInt(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function intToBool(value: number): boolean {
  return value === 1;
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

function readMetadataTitle(metadata: string): string {
  const parsed = parseJsonObject(metadata);
  return typeof parsed.title === "string" ? parsed.title : "";
}

interface SourceRow {
  id: string;
  name: string;
  type: string;
  weight: number;
  url: string | null;
  created_at: string;
  updated_at: string;
}

interface RawItemRow {
  id: string;
  source_id: string;
  source_url: string;
  canonical_url: string;
  content_hash: string;
  raw_content: string;
  published_at: string;
  collected_at: string;
  duplicate_of: string | null;
  metadata: string;
  created_at: string;
}

interface PendingRawItemRow {
  id: string;
  source_id: string;
  source_name: string;
  source_type: string;
  source_weight: number;
  source_url: string;
  raw_content: string;
  published_at: string;
  collected_at: string;
  duplicate_of: string | null;
  metadata: string;
}

interface ProcessedItemRow {
  id: string;
  raw_item_id: string | null;
  source_url: string;
  source_name: string;
  source_type: string;
  source_weight: number;
  published_at: string;
  collected_at: string;
  raw_content: string;
  summary: string;
  keywords: string;
  category: string;
  score: number;
  news_value_score: number;
  duplicate_of: string | null;
  selected: number;
  official_sources: string;
  article_title: string;
  article_body: string;
  intro_summary: string;
  assets: string;
  script_segments: string;
  tts_segments: string;
  timeline: string;
  subtitle_srt: string;
  ai_relevance_score: number;
  game_relevance_score: number;
  cross_relevance_score: number;
  ai_tags: string;
  game_tags: string;
  is_topic_candidate: number;
  exclusion_reason: string;
}

interface DedupeRow {
  id: string;
  raw_item_id: string | null;
  source_url: string;
  canonical_url: string | null;
  content_hash: string | null;
  article_title: string;
  raw_content: string;
  published_at: string;
  collected_at: string;
  source_type: string;
  source_weight: number;
  duplicate_of: string | null;
}

interface RawDedupeRow {
  id: string;
  raw_item_id: string;
  source_url: string;
  canonical_url: string;
  content_hash: string;
  raw_content: string;
  published_at: string;
  collected_at: string;
  duplicate_of: string | null;
  metadata: string;
  source_type: string;
  source_weight: number;
}

interface GeneratedOutputRow {
  id: string;
  run_id: string;
  item_id: string | null;
  output_type: string;
  output_path: string | null;
  content: string | null;
  metadata: string;
  created_at: string;
}

interface PipelineRunRow {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  config: string;
  result: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface ProcessingAuditRow {
  id: string;
  raw_item_id: string;
  processed_item_id: string | null;
  stage: string;
  status: string;
  message: string;
  metadata: string;
  created_at: string;
}
