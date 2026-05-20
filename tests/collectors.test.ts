import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { canonicalizeUrl, openNewsRepository, type NewsRepository } from "../src/db/newsRepository.js";
import { collectWithCollectors } from "../src/collectors/collectNews.js";
import { DemoCollector } from "../src/collectors/demoCollector.js";
import { extractGamerskyItems, JsonApiCollector } from "../src/collectors/jsonApiCollector.js";
import { MarkdownCollector } from "../src/collectors/markdownCollector.js";
import { parseFeedXml, RssCollector } from "../src/collectors/rssCollector.js";
import type { CollectionResult, Collector, FetchLike, RawCollectedItem } from "../src/collectors/types.js";
import { normalizeCollectedUrl } from "../src/collectors/url.js";
import { extractListingLinks } from "../src/collectors/webPageCollector.js";
import type { SourceDefinition } from "../src/config/sourceRegistry.js";

let tempDir: string | undefined;
let repository: NewsRepository | undefined;

afterEach(async () => {
  repository?.close();
  repository = undefined;

  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("collectors", () => {
  test("demo collector returns deterministic AI x game sample items", async () => {
    const result = await new DemoCollector().collect([], new Date("2026-05-19T01:00:00.000Z"));

    expect(result.failures).toEqual([]);
    expect(result.items.map((item) => item.title)).toEqual([
      "AI NPC tooling reaches live game operations",
      "Generative asset review enters game QA"
    ]);
    expect(result.items.every((item) => item.source_type === "ai_game_media")).toBe(true);
    expect(result.items[0]?.collected_at).toBe("2026-05-19T01:00:00.000Z");
  });

  test("ingests local Markdown files with frontmatter", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "manual-collector-"));
    const manualDir = join(tempDir, "data", "manual");
    await mkdir(manualDir, { recursive: true });
    await writeFile(
      join(manualDir, "submission.md"),
      [
        "---",
        "source_url: https://example.com/story?utm_source=manual#comments",
        "source_name: WeChat clipping",
        "published_at: 2026-05-18",
        "tags: ai, game, qa",
        "---",
        "# Manual AI game item",
        "",
        "A manual note about AI-assisted game QA."
      ].join("\n"),
      "utf8"
    );

    const result = await new MarkdownCollector({ manualDir }).collect([manualSource], new Date("2026-05-19T00:00:00.000Z"));

    expect(result.failures).toEqual([]);
    expect(result.items[0]).toMatchObject({
      title: "Manual AI game item",
      url: "https://example.com/story",
      source_name: "WeChat clipping",
      published_at: "2026-05-18T00:00:00.000Z",
      excerpt: "A manual note about AI-assisted game QA."
    });
    expect(result.items[0]?.metadata.tags).toEqual(["ai", "game", "qa"]);
  });

  test("parses RSS fixture XML into normalized raw items", () => {
    const xml = [
      "<?xml version=\"1.0\"?>",
      "<rss><channel><item>",
      "<title>AI tools for game studios</title>",
      "<link>https://example.com/article?utm_medium=rss&amp;b=2&amp;a=1#comments</link>",
      "<description><![CDATA[AI tooling reaches game production.]]></description>",
      "<pubDate>Mon, 18 May 2026 10:00:00 GMT</pubDate>",
      "<dc:creator>Reporter</dc:creator>",
      "</item></channel></rss>"
    ].join("");

    const items = parseFeedXml(xml, rssSource, new Date("2026-05-19T00:00:00.000Z"));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "AI tools for game studios",
      url: "https://example.com/article?a=1&b=2",
      source_name: "Example RSS",
      author: "Reporter",
      published_at: "2026-05-18T10:00:00.000Z",
      raw_content: "AI tooling reaches game production."
    });
  });

  test("maps youxituoluo JSON payload into normalized raw items", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({
        code: 200,
        data: {
          data: [{
            aid: 534496,
            title: "游戏陀螺示例标题",
            dis: "行业动态摘要",
            sendtime: 1779174089.775337,
            slugs: ["news"],
            tags: [{ name: "巨人网络" }, { name: "融资" }]
          }]
        }
      }));

    const result = await new JsonApiCollector({ fetch: fetchImpl }).collect([youxituoluoSource], new Date("2026-05-19T08:00:00.000Z"));

    expect(result.failures).toEqual([]);
    expect(result.items[0]).toMatchObject({
      title: "游戏陀螺示例标题",
      url: "https://www.youxituoluo.com/534496.html",
      source_name: "游戏陀螺",
      excerpt: "行业动态摘要"
    });
    expect(result.items[0]?.metadata.tags).toEqual(["巨人网络", "融资"]);
  });

  test("extracts gamersky JSONP HTML items into normalized raw items", () => {
    const html = [
      "<li>",
      "<div class=\"tit\"><a class=\"tt\" href=\"https://www.gamersky.com/news/202605/2142388.shtml\" target=\"_blank\" title=\"AI 大神新作\">AI 大神新作</a></div>",
      "<div class=\"con\">",
      "<div class=\"txt\">AI 大神带来了最新游戏相关内容。</div>",
      "<div class=\"tem\"><div class=\"time\">2026-05-19 15:16</div></div>",
      "</div>",
      "</li>"
    ].join("");

    const items = extractGamerskyItems(html, gamerskySource, "2026-05-19T08:00:00.000Z");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "AI 大神新作",
      url: "https://www.gamersky.com/news/202605/2142388.shtml",
      excerpt: "AI 大神带来了最新游戏相关内容。",
      published_at: "2026-05-19T07:16:00.000Z"
    });
  });

  test("extracts Chuapp daily listing items with author, excerpt, and date", () => {
    const html = [
      "<div class=\"category-list\">",
      "<a class=\"fn-clear\" href=\"/article/291361.html\" target=\"_blank\" title=\"触乐本周行业大事\">",
      "<dl class=\"fn-left\">",
      "<dd class=\"fn-clear\"><span class=\"fn-left\"><em>甄能达</em>05月16日</span><span class=\"fn-right\">0条评论</span></dd>",
      "<dt>触乐本周行业大事</dt>",
      "<dd>网易《万民长歌：三国》“复活”。</dd>",
      "</dl>",
      "</a>",
      "</div>"
    ].join("");

    const items = extractListingLinks(html, chuappHtmlSource, new Date("2026-05-19T08:00:00.000Z"));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "触乐本周行业大事",
      url: "https://www.chuapp.com/article/291361.html",
      author: "甄能达",
      excerpt: "网易《万民长歌：三国》“复活”。",
      published_at: "2026-05-15T16:00:00.000Z"
    });
  });

  test("extracts Gcores news listing items with relative time", () => {
    const html = [
      "<a class=\"news\" href=\"/articles/214657\" target=\"_blank\">",
      "<div class=\"news_content\"><h3>《明日方舟：终末地》新版本前瞻预告节目将于5月22日播出</h3></div>",
      "<div class=\"news_meta\"><span class=\"me-3\">10 分钟前</span><span>2 喜欢</span></div>",
      "</a>"
    ].join("");

    const items = extractListingLinks(html, gcoresHtmlSource, new Date("2026-05-19T08:00:00.000Z"));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "《明日方舟：终末地》新版本前瞻预告节目将于5月22日播出",
      url: "https://www.gcores.com/articles/214657",
      published_at: "2026-05-19T07:50:00.000Z"
    });
  });

  test("extracts 3DM news listing items with absolute datetime and summary", () => {
    const html = [
      "<li class=\"selectpost\">",
      "<a href=\"https://www.3dmgame.com/news/202605/3944498.html\" target=\"_blank\" class=\"bt\">微软公布新功能组件XBOX Player Voice 提升玩家参与度</a>",
      "<div class=\"bq\"><span class=\"time\">2026-05-19 13:56:39</span></div>",
      "<div class=\"miaoshu\">微软公司日前公布了新功能组件“XBOX Player Voice”。</div>",
      "</li>"
    ].join("");

    const items = extractListingLinks(html, threeDmHtmlSource, new Date("2026-05-19T08:00:00.000Z"));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "微软公布新功能组件XBOX Player Voice 提升玩家参与度",
      url: "https://www.3dmgame.com/news/202605/3944498.html",
      excerpt: "微软公司日前公布了新功能组件“XBOX Player Voice”。",
      published_at: "2026-05-19T05:56:39.000Z"
    });
  });

  test("normalizes URLs for duplicate-safe collection and storage", () => {
    expect(normalizeCollectedUrl("HTTPS://Example.com/Story/?utm_source=x&fbclid=1&b=2&a=1#frag")).toBe(
      "https://example.com/Story?a=1&b=2"
    );
    expect(canonicalizeUrl("HTTPS://Example.com/Story/?utm_source=x&fbclid=1&b=2&a=1#frag")).toBe(
      "https://example.com/Story?a=1&b=2"
    );
  });

  test("isolates RSS source failures and persists successful items once", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "collect-service-"));
    repository = openNewsRepository(join(tempDir, "news.sqlite"));
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      if (url.includes("bad")) {
        throw new Error("network failed");
      }
      return new Response("<rss><channel><item><title>Good item</title><link>https://example.com/good</link><description>Body</description></item></channel></rss>");
    };

    const result = await collectWithCollectors(
      repository,
      [
        { ...rssSource, id: "bad-rss", name: "Bad RSS", url: "https://bad.example/rss" },
        rssSource
      ],
      [new RssCollector({ fetch: fetchImpl })],
      new Date("2026-05-19T00:00:00.000Z")
    );
    const repeated = await collectWithCollectors(
      repository,
      [rssSource],
      [new RssCollector({ fetch: fetchImpl })],
      new Date("2026-05-19T00:01:00.000Z")
    );

    expect(result.failures).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result.inserted).toBe(1);
    expect(repeated.inserted).toBe(0);
    expect(repeated.skippedDuplicates).toBe(1);
  });

  test("rejects exact content duplicates during ingestion", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "collect-content-dedupe-"));
    repository = openNewsRepository(join(tempDir, "news.sqlite"));
    const now = new Date("2026-05-19T00:00:00.000Z");

    const result = await collectWithCollectors(
      repository,
      [rssSource],
      [new StaticCollector([
        rawItem({ title: "First", url: "https://example.com/first", raw_content: "AI game launch details" }),
        rawItem({ title: "Second", url: "https://example.com/second", raw_content: "  ai game launch details  " })
      ])],
      now
    );

    expect(result.inserted).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.markedDuplicates).toBe(0);
  });

  test("marks near duplicates inside the 72-hour window and ignores older matches", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "collect-window-dedupe-"));
    repository = openNewsRepository(join(tempDir, "news.sqlite"));

    const oldResult = await collectWithCollectors(
      repository,
      [rssSource],
      [new StaticCollector([
        rawItem({
          title: "AI NPC tools launch for live ops",
          url: "https://example.com/old",
          raw_content: "A game studio launched AI NPC tooling for live operations teams.",
          collected_at: "2026-05-15T23:00:00.000Z"
        })
      ])],
      new Date("2026-05-15T23:00:00.000Z")
    );
    const outsideWindow = await collectWithCollectors(
      repository,
      [rssSource],
      [new StaticCollector([
        rawItem({
          title: "Exclusive: AI NPC tools launched for live ops",
          url: "https://example.com/new",
          raw_content: "A game studio launches AI NPC tools for live operations teams.",
          collected_at: "2026-05-19T00:00:00.000Z"
        })
      ])],
      new Date("2026-05-19T00:00:00.000Z"),
      500,
      72
    );
    const insideWindow = await collectWithCollectors(
      repository,
      [rssSource],
      [new StaticCollector([
        rawItem({
          title: "Report: AI NPC tools launched for live ops",
          url: "https://example.com/newer",
          raw_content: "A game studio launches AI NPC tools for live operations teams today.",
          collected_at: "2026-05-19T01:00:00.000Z"
        })
      ])],
      new Date("2026-05-19T01:00:00.000Z"),
      500,
      72
    );

    const recent = repository.listRecentItemsForDedupe(10);

    expect(oldResult.inserted).toBe(1);
    expect(outsideWindow.markedDuplicates).toBe(0);
    expect(insideWindow.markedDuplicates).toBe(1);
    expect(recent.find((item) => item.sourceUrl === "https://example.com/newer")?.duplicateOf).toBeTruthy();
  });
});

const rssSource: SourceDefinition = {
  id: "example-rss",
  name: "Example RSS",
  url: "https://example.com/feed.xml",
  source_group: "ai_x_game",
  source_type: "ai_game_media",
  priority: "high",
  source_weight: 90,
  suggested_frequency: "daily",
  collection_strategy: "rss",
  max_items_per_window: 10
};

const manualSource: SourceDefinition = {
  id: "manual",
  name: "Manual",
  source_group: "manual",
  source_type: "community",
  priority: "high",
  source_weight: 75,
  suggested_frequency: "manual",
  collection_strategy: "manual_markdown",
  max_items_per_window: 10
};

const youxituoluoSource: SourceDefinition = {
  id: "youxituoluo",
  name: "游戏陀螺",
  url: "https://www.youxituoluo.com/",
  source_group: "game_native",
  source_type: "game_media",
  priority: "medium",
  source_weight: 74,
  suggested_frequency: "daily",
  collection_strategy: "json_api",
  max_items_per_window: 10
};

const gamerskySource: SourceDefinition = {
  id: "gamersky",
  name: "游民星空",
  url: "https://www.gamersky.com/news/",
  source_group: "game_native",
  source_type: "game_media",
  priority: "low",
  source_weight: 48,
  suggested_frequency: "daily",
  collection_strategy: "json_api",
  max_items_per_window: 50
};

const chuappHtmlSource: SourceDefinition = {
  id: "chuapp",
  name: "触乐",
  url: "https://www.chuapp.com/category/index/id/daily/p/1.html",
  source_group: "game_native",
  source_type: "game_media",
  priority: "high",
  source_weight: 84,
  suggested_frequency: "daily",
  collection_strategy: "web_page",
  max_items_per_window: 12
};

const gcoresHtmlSource: SourceDefinition = {
  id: "gcores",
  name: "机核",
  url: "https://www.gcores.com/news",
  source_group: "game_native",
  source_type: "community",
  priority: "high",
  source_weight: 82,
  suggested_frequency: "daily",
  collection_strategy: "web_page",
  max_items_per_window: 20
};

const threeDmHtmlSource: SourceDefinition = {
  id: "3dm",
  name: "3DM",
  url: "https://www.3dmgame.com/news_all_2/",
  source_group: "game_native",
  source_type: "game_media",
  priority: "low",
  source_weight: 45,
  suggested_frequency: "daily",
  collection_strategy: "web_page",
  max_items_per_window: 120
};

class StaticCollector implements Collector {
  readonly name = "static";

  constructor(private readonly staticItems: RawCollectedItem[]) {}

  async collect(): Promise<CollectionResult> {
    return { items: this.staticItems, failures: [] };
  }
}

function rawItem(overrides: Partial<RawCollectedItem>): RawCollectedItem {
  return {
    title: "AI game update",
    url: "https://example.com/item",
    source_name: "Example RSS",
    source_type: "ai_game_media",
    published_at: "2026-05-18T10:00:00.000Z",
    collected_at: "2026-05-19T00:00:00.000Z",
    author: null,
    excerpt: "AI game update",
    raw_content: "AI game update",
    metadata: {},
    ...overrides
  };
}
