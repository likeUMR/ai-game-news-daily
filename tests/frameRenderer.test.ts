import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { NewsItem, TimelineEvent } from "../src/pipeline/types.js";
import { buildVideoFrames, escapeHtml, renderVideoFrames } from "../src/video/frameRenderer.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("video frame rendering", () => {
  test("escapes template content before writing HTML", () => {
    expect(escapeHtml(`A&B <script>"x"</script> 'y'`)).toBe(
      "A&amp;B &lt;script&gt;&quot;x&quot;&lt;/script&gt; &#39;y&#39;"
    );

    const frames = buildVideoFrames([
      createNewsItem({
        id: "item-1",
        articleTitle: `Unsafe <img src=x onerror=alert("x")>`,
        summary: "A&B",
        sourceName: `Source "Name"`
      })
    ], createTimeline(), "2026-05-19T00:00:00.000Z");

    const newsFrame = frames.find((frame) => frame.kind === "news");
    expect(newsFrame?.html).toContain("&lt;img src=x onerror=alert(&quot;x&quot;)&gt;");
    expect(newsFrame?.html).not.toContain("<img src=x");
  });

  test("creates title, category, per-item, and outro frames with mapped timeline metadata", () => {
    const items = [
      createNewsItem({ id: "item-1", category: "AI x Game", articleTitle: "First" }),
      createNewsItem({ id: "item-2", category: "AI x Game", articleTitle: "Second" })
    ];
    const frames = buildVideoFrames(items, [
      { itemId: "item-1", startMs: 0, endMs: 1200, title: "First", text: "First line" },
      { itemId: "item-2", startMs: 1200, endMs: 3000, title: "Second", text: "Second line" }
    ], "2026-05-19T00:00:00.000Z");

    expect(frames.map((frame) => frame.kind)).toEqual([
      "title",
      "category",
      "news",
      "quote-source",
      "progress",
      "news",
      "quote-source",
      "progress",
      "outro"
    ]);

    const secondNews = frames.find((frame) => frame.kind === "news" && frame.metadata.itemId === "item-2");
    expect(secondNews?.metadata).toMatchObject({
      sourceName: "Test Source",
      timelineStartMs: 1200,
      timelineEndMs: 3000,
      itemIndex: 2,
      itemCount: 2
    });
  });

  test("writes HTML and placeholder PNG/SVG frames when fallback renderer is selected", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "news-frames-"));
    const result = await renderVideoFrames(
      [createNewsItem({ id: "item-1", articleTitle: "Frame test" })],
      createTimeline(),
      {
        generatedAt: "2026-05-19T08:00:00.000Z",
        outputRoot: tempDir,
        dimensions: { width: 1280, height: 720 },
        renderer: "placeholder"
      }
    );

    expect(result.renderer).toBe("placeholder");
    expect(result.htmlDir).toBe(join(tempDir, "2026-05-19", "frames", "html"));
    expect(result.pngDir).toBe(join(tempDir, "2026-05-19", "frames", "png"));
    expect(result.frames).toHaveLength(6);

    const first = result.frames[0]!;
    expect(first.htmlPath && existsSync(first.htmlPath)).toBe(true);
    expect(first.pngPath && existsSync(first.pngPath)).toBe(true);
    expect(existsSync(first.pngPath!.replace(/\.png$/u, ".svg"))).toBe(true);

    const html = await readFile(first.htmlPath!, "utf8");
    const png = await readFile(first.pngPath!);
    expect(html).toContain("<!doctype html>");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  test("falls back safely when browser rendering cannot start", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "news-frames-browser-fallback-"));
    const result = await renderVideoFrames(
      [createNewsItem({ id: "item-1" })],
      createTimeline(),
      {
        generatedAt: "2026-05-19T08:00:00.000Z",
        outputRoot: tempDir,
        renderer: "auto"
      }
    );

    expect(["browser", "placeholder"]).toContain(result.renderer);
    expect(result.frames.every((frame) => frame.pngPath && existsSync(frame.pngPath))).toBe(true);
    if (result.renderer === "placeholder") {
      expect(result.error).toBeTruthy();
    }
  });
});

function createTimeline(): TimelineEvent[] {
  return [{ itemId: "item-1", startMs: 0, endMs: 1500, title: "Frame test", text: "Frame test" }];
}

function createNewsItem(overrides: Partial<NewsItem> & Pick<NewsItem, "id">): NewsItem {
  const now = "2026-05-19T00:00:00.000Z";
  return {
    sourceUrl: "https://example.com/source",
    sourceName: "Test Source",
    sourceType: "ai_game_media",
    sourceWeight: 90,
    publishedAt: now,
    collectedAt: now,
    rawContent: "AI NPC tooling ships for game studios.",
    summary: "AI NPC tooling helps game studios.",
    keywords: ["AI", "game"],
    category: "AI x Game",
    score: 90,
    newsValueScore: 90,
    duplicateOf: null,
    selected: true,
    officialSources: ["https://example.com/source"],
    articleTitle: "AI NPC tool ships",
    articleBody: "A studio released AI-assisted NPC tooling.",
    introSummary: "AI tooling helps narrative testing.",
    assets: [],
    scriptSegments: [],
    ttsSegments: [],
    timeline: [],
    subtitleSrt: "",
    aiRelevanceScore: 90,
    gameRelevanceScore: 90,
    crossRelevanceScore: 90,
    aiTags: [],
    gameTags: [],
    isTopicCandidate: true,
    exclusionReason: "",
    ...overrides,
    id: overrides.id
  };
}
