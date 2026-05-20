import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseCategoryCounts, selectAndVerifyItems, writeSelectionAudit } from "../src/pipeline/selection.js";
import type { NewsItem, SourceType } from "../src/pipeline/types.js";

const generatedAt = "2026-05-19T12:00:00.000Z";
let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("selectAndVerifyItems", () => {
  test("balances selected items by configured category and ranking evidence", () => {
    const result = selectAndVerifyItems([
      createItem("ai-high", { category: "AI x Game", score: 90, sourceWeight: 80 }),
      createItem("ai-low", { category: "AI x Game", score: 75, sourceWeight: 90 }),
      createItem("engine-high", { category: "Engine", score: 85, sourceWeight: 75 }),
      createItem("engine-low", { category: "Engine", score: 70, sourceWeight: 95 })
    ], options({ dailyItemCount: 2, categoryCounts: { "AI x Game": 1, Engine: 1 } }));

    const selected = result.items.filter((item) => item.selected);

    expect(selected.map((item) => item.id)).toEqual(["ai-high", "engine-high"]);
    expect(result.audit.selected.map((entry) => entry.evidence.category)).toEqual(["AI x Game", "Engine"]);
  });

  test("selects only duplicate group winner and preserves alternative official sources", () => {
    const canonical = createItem("canonical", {
      score: 82,
      sourceType: "ai_game_media",
      sourceUrl: "https://media.example.com/story",
      officialSources: []
    });
    const duplicate = createItem("official-duplicate", {
      score: 95,
      sourceType: "official",
      sourceUrl: "https://studio.example.com/news/story",
      duplicateOf: "canonical",
      officialSources: ["https://studio.example.com/press/story"]
    });

    const result = selectAndVerifyItems([canonical, duplicate], options({ dailyItemCount: 1 }));
    const selected = result.items.find((item) => item.selected);

    expect(selected?.id).toBe("canonical");
    expect(selected?.sourceUrl).toBe("https://studio.example.com/news/story");
    expect(selected?.officialSources).toEqual([
      "https://studio.example.com/news/story",
      "https://studio.example.com/press/story"
    ]);
    expect(result.audit.duplicate).toHaveLength(1);
    expect(result.audit.duplicate[0]?.id).toBe("official-duplicate");
  });

  test("fails verification for unsupported generated claims", () => {
    const result = selectAndVerifyItems([
      createItem("unsupported", {
        articleTitle: "Quantum metaverse acquisition transforms cloud robots",
        articleBody: "The company acquired satellite robotics infrastructure for holographic advertising."
      })
    ], options({ dailyItemCount: 1 }));

    expect(result.items.find((item) => item.id === "unsupported")?.selected).toBe(false);
    expect(result.audit.failedVerification[0]?.reasons).toContain(
      "generated claims do not trace to raw content, summary, or source metadata"
    );
  });

  test("fills unused category quotas with highest-confidence verified items only", () => {
    const result = selectAndVerifyItems([
      createItem("ai-best", { category: "AI x Game", score: 92 }),
      createItem("ai-next", { category: "AI x Game", score: 88 }),
      createItem("low-trust", { category: "AI x Game", score: 70, sourceWeight: 20 }),
      createItem("old-engine", { category: "Engine", score: 96, publishedAt: "2026-05-10T00:00:00.000Z" })
    ], options({
      dailyItemCount: 3,
      categoryCounts: { "AI x Game": 1, Engine: 2 },
      freshnessHours: 72
    }));

    const selected = result.items.filter((item) => item.selected).map((item) => item.id);

    expect(selected).toEqual(["ai-best", "ai-next"]);
    expect(result.audit.failedVerification.map((entry) => entry.id).sort()).toEqual(["low-trust", "old-engine"]);
  });

  test("writes audit report with selected, rejected, duplicate, and failed-verification sections", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "selection-audit-"));
    const result = selectAndVerifyItems([
      createItem("selected", { score: 95 }),
      createItem("rejected", { score: 80 }),
      createItem("duplicate", { duplicateOf: "selected", score: 99 }),
      createItem("failed", { articleBody: "" })
    ], options({ dailyItemCount: 1 }));

    const auditPath = await writeSelectionAudit(tempDir, result.audit);
    const audit = JSON.parse(await readFile(auditPath, "utf8")) as typeof result.audit;

    expect(auditPath).toContain(join("audit", "editorial-selection-audit.json"));
    expect(audit.selected).toHaveLength(1);
    expect(audit.rejected.map((entry) => entry.id)).toContain("rejected");
    expect(audit.duplicate.map((entry) => entry.id)).toContain("duplicate");
    expect(audit.failedVerification.map((entry) => entry.id)).toContain("failed");
  });
});

test("parseCategoryCounts ignores malformed entries conservatively", () => {
  expect(parseCategoryCounts("AI x Game=3, bad, Engine=2, Empty=0")).toEqual({
    "AI x Game": 3,
    Engine: 2
  });
});

function options(overrides: Partial<Parameters<typeof selectAndVerifyItems>[1]> = {}): Parameters<typeof selectAndVerifyItems>[1] {
  return {
    generatedAt,
    dailyItemCount: 5,
    categoryCounts: { "AI x Game": 5 },
    lowTrustSourceWeight: 40,
    lowTrustHighScore: 85,
    freshnessHours: 72,
    ...overrides
  };
}

function createItem(id: string, overrides: Partial<NewsItem> = {}): NewsItem {
  const category = overrides.category ?? "AI x Game";
  const body = "A game studio released AI-assisted NPC tooling for live operations and narrative testing.";

  return {
    id,
    sourceName: "Studio News",
    sourceType: (overrides.sourceType as SourceType | undefined) ?? "ai_game_media",
    sourceWeight: overrides.sourceWeight ?? 80,
    sourceUrl: overrides.sourceUrl ?? `https://example.com/${id}`,
    rawContent: "A game studio released AI-assisted NPC tooling for live operations and narrative testing.",
    publishedAt: overrides.publishedAt ?? "2026-05-19T10:00:00.000Z",
    collectedAt: "2026-05-19T11:00:00.000Z",
    summary: "AI-assisted NPC tooling for game live operations and narrative testing.",
    keywords: ["AI", "game", "NPC", "tooling"],
    category,
    score: overrides.score ?? 90,
    newsValueScore: 90,
    duplicateOf: overrides.duplicateOf ?? null,
    selected: false,
    officialSources: overrides.officialSources ?? [`https://example.com/${id}`],
    articleTitle: overrides.articleTitle ?? "AI tooling moves deeper into game production",
    articleBody: overrides.articleBody ?? body,
    introSummary: "AI x game production signal",
    assets: [],
    scriptSegments: [],
    ttsSegments: [],
    timeline: [],
    subtitleSrt: "",
    aiRelevanceScore: 90,
    gameRelevanceScore: 90,
    crossRelevanceScore: 90,
    aiTags: ["tooling"],
    gameTags: ["npc"],
    isTopicCandidate: overrides.isTopicCandidate ?? true,
    exclusionReason: overrides.exclusionReason ?? ""
  };
}
