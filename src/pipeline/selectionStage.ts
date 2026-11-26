import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "../config/env.js";
import { openNewsRepository } from "../db/newsRepository.js";
import { parseCategoryCounts, selectAndVerifyItems, writeSelectionAudit, type SelectionAudit } from "./selection.js";
import type { NewsItem } from "./types.js";
import { editionDay, editionTime, publicationWindow, requireEditionItems } from "./edition.js";

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
  const generatedAt = editionTime(options.date);
  const date = editionDay(generatedAt);
  const outputDir = join(config.OUTPUT_DIR, date);

  await mkdir(outputDir, { recursive: true });

  const repository = openNewsRepository(config.DATABASE_PATH);
  try {
    const candidates = repository.listEditionItems(publicationWindow(generatedAt, config.COLLECTION_WINDOW_HOURS), config.MOCK_MODE);
    const selection = selectAndVerifyItems(candidates, {
      generatedAt,
      dailyItemCount: config.DAILY_ITEM_COUNT,
      categoryCounts: parseCategoryCounts(config.DAILY_CATEGORY_COUNTS),
      lowTrustSourceWeight: config.LOW_TRUST_SOURCE_WEIGHT,
      lowTrustHighScore: config.LOW_TRUST_HIGH_SCORE,
      freshnessHours: config.SELECTION_FRESHNESS_HOURS
    });

    await writeSelectionAudit(outputDir, selection.audit, "latest-selection-attempt.json");
    if (!config.MOCK_MODE) requireEditionItems(selection.audit.selected.length, date);
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
