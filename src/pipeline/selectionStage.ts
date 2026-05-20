import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "../config/env.js";
import { openNewsRepository } from "../db/newsRepository.js";
import { parseCategoryCounts, selectAndVerifyItems, writeSelectionAudit, type SelectionAudit } from "./selection.js";
import type { NewsItem } from "./types.js";

export interface SelectionStageResult {
  generatedAt: string;
  outputDir: string;
  selectedItems: NewsItem[];
  candidateItems: NewsItem[];
  auditPath: string;
  audit: SelectionAudit;
}

export interface SelectionStageOptions {
  date?: string;
}

export async function runSelection(config: AppConfig, options: SelectionStageOptions = {}): Promise<SelectionStageResult> {
  const generatedAt = normalizeGeneratedAt(options.date);
  const date = generatedAt.slice(0, 10);
  const outputDir = join(config.OUTPUT_DIR, date);

  await mkdir(outputDir, { recursive: true });

  const repository = openNewsRepository(config.DATABASE_PATH);
  try {
    const candidates = repository.listTopicCandidates(config.MAX_ITEMS_TOTAL, config.MIN_CROSS_RELEVANCE_SCORE);
    const selection = selectAndVerifyItems(candidates, {
      generatedAt,
      dailyItemCount: config.DAILY_ITEM_COUNT,
      categoryCounts: parseCategoryCounts(config.DAILY_CATEGORY_COUNTS),
      lowTrustSourceWeight: config.LOW_TRUST_SOURCE_WEIGHT,
      lowTrustHighScore: config.LOW_TRUST_HIGH_SCORE,
      freshnessHours: config.SELECTION_FRESHNESS_HOURS
    });

    for (const item of selection.items) {
      repository.saveProcessedFields(item);
    }

    const auditPath = await writeSelectionAudit(outputDir, selection.audit);

    return {
      generatedAt,
      outputDir,
      selectedItems: selection.items.filter((item) => item.selected),
      candidateItems: selection.items,
      auditPath,
      audit: selection.audit
    };
  } finally {
    repository.close();
  }
}

function normalizeGeneratedAt(date?: string): string {
  if (!date) {
    return new Date().toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    return `${date}T00:00:00.000Z`;
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --date value: ${date}`);
  }
  return parsed.toISOString();
}
