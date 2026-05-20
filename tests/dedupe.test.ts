import { describe, expect, test } from "vitest";
import { choosePreferredDedupeItem, markDuplicateNewsItems, normalizeTitle, scoreContentSimilarity } from "../src/pipeline/dedupe.js";
import type { NewsItem } from "../src/pipeline/types.js";

describe("markDuplicateNewsItems", () => {
  test("marks duplicate URLs without dropping source records", () => {
    const items = [
      createItem("first", "https://example.com/story?utm_source=newsletter#comments"),
      createItem("second", "https://example.com/story")
    ];

    const deduped = markDuplicateNewsItems(items);

    expect(deduped).toHaveLength(2);
    expect(deduped[0]?.duplicateOf).toBeNull();
    expect(deduped[1]?.duplicateOf).toBe("first");
    expect(items[1]?.duplicateOf).toBeNull();
  });

  test("uses collection-compatible URL canonicalization", () => {
    const items = [
      createItem("first", "HTTPS://Example.com/Story/?b=2&a=1&fbclid=abc#comments"),
      createItem("second", "https://example.com/Story?a=1&b=2")
    ];

    expect(markDuplicateNewsItems(items)[1]?.duplicateOf).toBe("first");
  });

  test("preserves case-sensitive paths when comparing URLs", () => {
    const items = [
      createItem("upper", "https://example.com/Story", "Upper path item"),
      createItem("lower", "https://example.com/story", "Lower path item")
    ];

    expect(markDuplicateNewsItems(items)[1]?.duplicateOf).toBeNull();
  });

  test("marks exact content duplicates when URLs differ", () => {
    const items = [
      createItem("first", "https://example.com/first", "AI studio ships NPC tools"),
      createItem("second", "https://example.com/second", "  ai studio ships npc tools  ")
    ];

    expect(markDuplicateNewsItems(items)[1]?.duplicateOf).toBe("first");
  });

  test("does not mark blank raw content as exact-content duplicates", () => {
    const items = [
      createItem("first", "https://example.com/first", "   "),
      createItem("second", "https://example.com/second", "\n\t")
    ];

    expect(markDuplicateNewsItems(items)[1]?.duplicateOf).toBeNull();
  });

  test("marks near-duplicate title and body matches", () => {
    const items = [
      createItem(
        "first",
        "https://example.com/first",
        "Game studio launches AI NPC tools for live operations teams",
        "AI NPC tools launch for live ops"
      ),
      createItem(
        "second",
        "https://example.com/second",
        "A game studio launched AI NPC tooling for live operations teams",
        "Exclusive: AI NPC tools launched for live ops"
      )
    ];

    const deduped = markDuplicateNewsItems(items);

    expect(normalizeTitle("Exclusive: AI NPC tools launched for live ops")).toBe("ai npc tools launched for live ops");
    expect(scoreContentSimilarity(toCandidate(items[0]!), toCandidate(items[1]!))).toBeGreaterThan(0.66);
    expect(deduped[1]?.duplicateOf).toBe("first");
  });

  test("prefers official, then earlier, then higher-weight source for duplicate events", () => {
    const community = createItem("community", "https://example.com/community", "AI game tooling ships", "AI game tooling ships");
    const official = createItem("official", "https://example.com/official", "AI game tooling ships", "AI game tooling ships");
    official.sourceType = "official";
    official.publishedAt = "2026-05-19T02:00:00.000Z";
    community.publishedAt = "2026-05-19T01:00:00.000Z";

    const earlier = createItem("earlier", "https://example.com/earlier", "AI game tooling ships", "AI game tooling ships");
    const later = createItem("later", "https://example.com/later", "AI game tooling ships", "AI game tooling ships");
    earlier.publishedAt = "2026-05-18T23:00:00.000Z";
    later.publishedAt = "2026-05-19T00:00:00.000Z";

    const lowWeight = createItem("low", "https://example.com/low", "AI game tooling ships", "AI game tooling ships");
    const highWeight = createItem("high", "https://example.com/high", "AI game tooling ships", "AI game tooling ships");
    lowWeight.publishedAt = highWeight.publishedAt;
    lowWeight.sourceWeight = 40;
    highWeight.sourceWeight = 90;

    expect(choosePreferredDedupeItem(community, official).id).toBe("official");
    expect(choosePreferredDedupeItem(earlier, later).id).toBe("earlier");
    expect(choosePreferredDedupeItem(lowWeight, highWeight).id).toBe("high");

    const deduped = markDuplicateNewsItems([community, official]);
    expect(deduped.find((item) => item.id === "official")?.duplicateOf).toBeNull();
    expect(deduped.find((item) => item.id === "community")?.duplicateOf).toBe("official");
  });

  test("repoints existing duplicate followers when a better canonical item arrives", () => {
    const first = createItem("first", "https://example.com/first", "AI game tooling ships", "AI game tooling ships");
    const follower = createItem("follower", "https://example.com/follower", "AI game tooling ships", "AI game tooling ships");
    const official = createItem("official", "https://example.com/official", "AI game tooling ships", "AI game tooling ships");
    official.sourceType = "official";

    const deduped = markDuplicateNewsItems([first, follower, official]);

    expect(deduped.find((item) => item.id === "official")?.duplicateOf).toBeNull();
    expect(deduped.find((item) => item.id === "first")?.duplicateOf).toBe("official");
    expect(deduped.find((item) => item.id === "follower")?.duplicateOf).toBe("official");
  });

  test("keeps batch dedupe stable when an existing item points outside the current batch", () => {
    const knownDuplicate = createItem("known-duplicate", "https://example.com/known", "AI game tooling ships", "AI game tooling ships");
    knownDuplicate.duplicateOf = "external-canonical";
    const current = createItem("current", "https://example.com/current", "AI game tooling ships", "AI game tooling ships");

    const deduped = markDuplicateNewsItems([knownDuplicate, current]);

    expect(deduped.find((item) => item.id === "known-duplicate")?.duplicateOf).toBe("external-canonical");
    expect(deduped.find((item) => item.id === "current")?.duplicateOf).toBe("external-canonical");
  });
});

function createItem(id: string, sourceUrl: string, rawContent = "AI game production update", articleTitle = ""): NewsItem {
  const now = "2026-05-19T00:00:00.000Z";

  return {
    id,
    sourceName: "Example",
    sourceType: "ai_game_media",
    sourceWeight: 80,
    sourceUrl,
    rawContent,
    publishedAt: now,
    collectedAt: now,
    summary: "",
    keywords: [],
    category: "",
    score: 0,
    newsValueScore: 0,
    duplicateOf: null,
    selected: false,
    officialSources: [],
    articleTitle,
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

function toCandidate(item: NewsItem) {
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
