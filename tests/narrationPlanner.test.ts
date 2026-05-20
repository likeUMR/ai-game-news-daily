import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { openNewsRepository, type NewsRepository } from "../src/db/newsRepository.js";
import type { NewsItem } from "../src/pipeline/types.js";
import { formatSrtTime, planVideoNarration, renderSrt, splitIntoSentences } from "../src/video/narrationPlanner.js";
import { MockTTSProvider } from "../src/video/ttsProvider.js";

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

describe("narration planning", () => {
  test("splits sentence-level TTS segments on Chinese and western punctuation", () => {
    expect(splitIntoSentences("第一条来了。第二条继续！Is this useful? 是的；收尾。")).toEqual([
      "第一条来了。",
      "第二条继续！",
      "Is this useful?",
      "是的；",
      "收尾。"
    ]);
  });

  test("mock TTS duration calculation is deterministic and writes a WAV file", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mock-tts-"));
    const provider = new MockTTSProvider({ baseMs: 500, msPerCharacter: 100, minMs: 900 });
    const outputPath = join(tempDir, "audio.wav");

    const result = await provider.synthesize({ id: "one", text: "你好 AI。", outputPath });
    const file = await readFile(outputPath);

    expect(result.durationMs).toBe(1000);
    expect(file.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(file.subarray(8, 12).toString("ascii")).toBe("WAVE");
  });

  test("builds a continuous timeline and valid SRT from synthesized sentence durations", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "narration-"));
    const provider = new MockTTSProvider({ baseMs: 0, msPerCharacter: 10, minMs: 100 });
    const item = createNewsItem({
      id: "item-1",
      articleTitle: "AI NPC 工具上线",
      introSummary: "它帮助工作室测试剧情。",
      articleBody: "开发者可以更快验证 live-ops 内容。",
      selected: true
    });

    const plan = await planVideoNarration([item], {
      generatedAt: "2026-05-19T00:00:00.000Z",
      outputRoot: tempDir,
      ttsProvider: provider
    });

    expect(plan.scriptSegments[0]).toContain("精选 1 条");
    expect(plan.ttsSegments.length).toBeGreaterThan(2);
    expect(plan.timeline[0]?.startMs).toBe(0);
    for (let index = 1; index < plan.timeline.length; index += 1) {
      expect(plan.timeline[index]?.startMs).toBe(plan.timeline[index - 1]?.endMs);
    }
    expect(plan.timeline.at(-1)?.endMs).toBe(plan.ttsSegments.reduce((total, segment) => total + segment.durationMs, 0));
    expect(plan.subtitleSrt).toMatch(/^1\n00:00:00,000 --> 00:00:00,\d{3}\n/m);
  });

  test("formats SRT timestamps and blocks", () => {
    expect(formatSrtTime(3_723_045)).toBe("01:02:03,045");
    expect(renderSrt([{
      itemId: "item-1",
      startMs: 0,
      endMs: 1500,
      title: "Fallback title",
      text: "字幕文本。"
    }])).toBe("1\n00:00:00,000 --> 00:00:01,500\n字幕文本。\n");
  });

  test("writes subtitles to dated output and saves narration fields to the database", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "narration-output-"));
    repository = openNewsRepository(join(tempDir, "news.sqlite"));
    const item = createNewsItem({
      id: "item-1",
      sourceUrl: "https://example.com/ai-npc",
      articleTitle: "AI NPC 工具上线",
      introSummary: "它帮助工作室测试剧情。",
      selected: true
    });

    const plan = await planVideoNarration([item], {
      generatedAt: "2026-05-19T08:00:00.000Z",
      outputRoot: join(tempDir, "output"),
      ttsProvider: new MockTTSProvider(),
      repository
    });
    const saved = repository.getProcessedItem("item-1");
    const subtitleFile = await readFile(join(tempDir, "output", "2026-05-19", "subtitles.srt"), "utf8");
    const audioStats = await stat(plan.ttsSegments[0]!.audioPath);

    expect(plan.subtitlePath).toBe(join(tempDir, "output", "2026-05-19", "subtitles.srt"));
    expect(subtitleFile).toBe(plan.subtitleSrt);
    expect(audioStats.size).toBeGreaterThan(44);
    expect(saved?.scriptSegments.length).toBeGreaterThan(0);
    expect(saved?.ttsSegments.length).toBeGreaterThan(0);
    expect(saved?.timeline.length).toBeGreaterThan(0);
    expect(saved?.subtitleSrt).toContain("-->");
  });
});

function createNewsItem(overrides: Partial<NewsItem> & Pick<NewsItem, "id">): NewsItem {
  const now = "2026-05-19T00:00:00.000Z";
  return {
    sourceUrl: "",
    sourceName: "Test Source",
    sourceType: "ai_game_media",
    sourceWeight: 90,
    publishedAt: now,
    collectedAt: now,
    rawContent: "AI NPC tooling ships for game studios.",
    summary: "AI NPC tooling helps game studios.",
    keywords: [],
    category: "AI x Game",
    score: 90,
    newsValueScore: 90,
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
