import { describe, expect, test } from "vitest";
import { renderDailyMarkdown, renderWeChatHtml, renderZhihuMarkdown } from "../src/render/markdownRenderer.js";
import type { NewsItem } from "../src/pipeline/types.js";

describe("renderDailyMarkdown", () => {
  test("renders report structure, table of contents, summaries, and source links", () => {
    const markdown = renderDailyMarkdown([
      createItem({
        articleTitle: "AI [tooling]\nlaunch (beta)",
        sourceName: "Example [Feed]",
        sourceUrl: "https://example.com/story path?x=<bad>",
        officialSources: ["https://official.example.com/post"],
        category: "AI x Game",
        introSummary: "Short **summary**",
        aiTags: ["tooling|ops"],
        gameTags: ["NPC > QA"],
        articleBody: "**Body markdown stays intact.**\n\n| Metric | Value |\n| --- | --- |\n| Teams | 4 |"
      })
    ], "2026-05-19T00:00:00.000Z");

    expect(markdown).toContain("# 智游镜 \\| 每日AI游戏新闻速递 20260519");
    expect(markdown).toContain("Date: 2026-05-19");
    expect(markdown).toContain("## Table of Contents");
    expect(markdown).toContain("- [AI x Game](#ai-x-game)");
    expect(markdown).toContain("- **AI \\[tooling\\] launch \\(beta\\)**: Short \\*\\*summary\\*\\*");
    expect(markdown).toContain("### AI \\[tooling\\] launch \\(beta\\)");
    expect(markdown).toContain("- Source: [Example \\[Feed\\]](<https://example.com/story%20path?x=%3Cbad%3E>)");
    expect(markdown).toContain("- Tags: tooling\\|ops, NPC \\> QA");
    expect(markdown).toContain("**Body markdown stays intact.**");
    expect(markdown).toContain("1. [Example \\[Feed\\]](<https://example.com/story%20path?x=%3Cbad%3E>)");
    expect(markdown).toContain("2. [Official 1](<https://official.example.com/post>)");
  });

  test("renders a Zhihu-compatible Markdown variant without raw anchor tags", () => {
    const markdown = renderZhihuMarkdown([
      createItem({
        articleTitle: "AI tooling",
        category: "AI x Game",
        introSummary: "Production signal",
        articleBody: "Paragraph with `code`."
      })
    ], "2026-05-19T00:00:00.000Z");

    expect(markdown).toContain("## 今日要点");
    expect(markdown).toContain("## 目录");
    expect(markdown).toContain("**点评**：Production signal");
    expect(markdown).toContain("**来源**：");
    expect(markdown).toContain("[Example](<https://example.com/story>)");
    expect(markdown).not.toContain("<a id=");
  });

  test("deduplicates source links by canonical URL while preserving source records", () => {
    const markdown = renderDailyMarkdown([
      createItem({
        sourceUrl: "https://example.com/story?utm_source=feed#comments",
        officialSources: [
          "https://example.com/story",
          "https://example.com/story?b=2&a=1",
          "https://example.com/story?a=1&b=2"
        ]
      })
    ], "2026-05-19T00:00:00.000Z");

    expect(markdown).toContain("1. [Example](<https://example.com/story?utm_source=feed#comments>)");
    expect(markdown).toContain("2. [Official 2](<https://example.com/story?b=2&a=1>)");
    expect(markdown).not.toContain("Official 1");
    expect(markdown).not.toContain("Official 3");
  });

  test("escapes and sanitizes WeChat HTML while preserving safe formatting", () => {
    const html = renderWeChatHtml([
      createItem({
        articleTitle: "Unsafe <script>alert(1)</script>",
        sourceName: "Bad <Feed>",
        sourceUrl: "javascript:alert(1)",
        officialSources: ["https://safe.example.com/a?x=<tag>"],
        publishedAt: "2026-05-19T08:37:42.000Z",
        introSummary: "Summary & details",
        articleBody: "Body with **bold** and `code`.\n\n```html\n<script>alert(1)</script>\n```\n\n| Key | Value |\n| --- | --- |\n| <x> | & |"
      })
    ], "2026-05-19T00:00:00.000Z");

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code style=");
    expect(html).toContain("<table style=");
    expect(html).toContain("https://safe.example.com/a?x=&lt;tag&gt;");
    expect(html).not.toContain("javascript:alert");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Published: 2026-05-19 08:37 | Score: 90");
    expect(html).toContain("style=");
  });
});

function createItem(overrides: Partial<NewsItem>): NewsItem {
  const now = "2026-05-19T00:00:00.000Z";

  return {
    id: "item-1",
    sourceUrl: "https://example.com/story",
    sourceName: "Example",
    sourceType: "ai_game_media",
    sourceWeight: 90,
    publishedAt: now,
    collectedAt: now,
    rawContent: "",
    summary: "",
    keywords: [],
    category: "",
    score: 0,
    newsValueScore: 0,
    duplicateOf: null,
    selected: true,
    officialSources: [],
    articleTitle: "Title",
    articleBody: "Body",
    introSummary: "",
    assets: [],
    scriptSegments: [],
    ttsSegments: [],
    timeline: [],
    subtitleSrt: "",
    aiRelevanceScore: 0,
    gameRelevanceScore: 0,
    crossRelevanceScore: 90,
    aiTags: [],
    gameTags: [],
    isTopicCandidate: true,
    exclusionReason: "",
    ...overrides
  };
}
