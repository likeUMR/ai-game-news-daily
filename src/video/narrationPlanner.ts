import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NewsRepository } from "../db/newsRepository.js";
import type { NewsItem, TimelineEvent, TtsSegment } from "../pipeline/types.js";
import { createTTSProvider, type TTSProvider } from "./ttsProvider.js";

export interface NarrationPlan {
  scriptSegments: string[];
  ttsSegments: TtsSegment[];
  timeline: TimelineEvent[];
  subtitleSrt: string;
  subtitlePath: string;
  items: NewsItem[];
}

export interface NarrationPlanOptions {
  generatedAt: string;
  outputRoot: string;
  ttsProvider?: TTSProvider;
  ttsProviderName?: string;
  repository?: NewsRepository;
}

export async function planVideoNarration(
  items: NewsItem[],
  options: NarrationPlanOptions
): Promise<NarrationPlan> {
  const date = options.generatedAt.slice(0, 10);
  const outputDir = join(options.outputRoot, date);
  const audioDir = join(outputDir, "audio");
  const provider = options.ttsProvider ?? createTTSProvider(options.ttsProviderName ?? "mock");
  const scriptSegments = generateScriptSegments(items);
  const ttsInputs = scriptSegments.flatMap((script, scriptSegmentIndex) => splitIntoSentences(script.text).map((text) => ({
    itemId: script.itemId,
    title: script.title,
    scriptSegmentIndex,
    text
  })));

  const ttsSegments: TtsSegment[] = [];
  const timeline: TimelineEvent[] = [];
  let cursor = 0;

  for (const [index, segment] of ttsInputs.entries()) {
    const id = `tts-${String(index + 1).padStart(3, "0")}`;
    const audioPath = join(audioDir, `${id}.wav`);
    const result = await provider.synthesize({ id, text: segment.text, outputPath: audioPath });
    const startMs = cursor;
    const endMs = startMs + result.durationMs;
    cursor = endMs;

    ttsSegments.push({
      id,
      itemId: segment.itemId,
      scriptSegmentIndex: segment.scriptSegmentIndex,
      text: segment.text,
      durationMs: result.durationMs,
      audioPath: result.audioPath,
      startMs,
      endMs
    });
    timeline.push({
      itemId: segment.itemId,
      ttsSegmentId: id,
      startMs,
      endMs,
      title: segment.title,
      text: segment.text,
      audioPath: result.audioPath
    });
  }

  const subtitleSrt = renderSrt(timeline);
  const subtitlePath = join(outputDir, "subtitles.srt");
  await mkdir(outputDir, { recursive: true });
  await writeFile(subtitlePath, subtitleSrt, "utf8");

  const itemScriptSegments = new Map<string, string[]>();
  for (const segment of scriptSegments) {
    if (items.some((item) => item.id === segment.itemId)) {
      itemScriptSegments.set(segment.itemId, [...(itemScriptSegments.get(segment.itemId) ?? []), segment.text]);
    }
  }
  const itemTtsSegments = groupByItem(items, ttsSegments);
  const itemTimeline = groupByItem(items, timeline);
  const itemSubtitleEntries = groupSrtByItem(items, timeline);
  const updatedItems = items.map((item) => ({
    ...item,
    scriptSegments: itemScriptSegments.get(item.id) ?? [],
    ttsSegments: itemTtsSegments.get(item.id) ?? [],
    timeline: itemTimeline.get(item.id) ?? [],
    subtitleSrt: itemSubtitleEntries.get(item.id) ?? ""
  }));

  for (const item of updatedItems) {
    options.repository?.saveProcessedFields(item);
  }

  return {
    scriptSegments: scriptSegments.map((segment) => segment.text),
    ttsSegments,
    timeline,
    subtitleSrt,
    subtitlePath,
    items: updatedItems
  };
}

export function generateScriptSegments(items: NewsItem[]): Array<{ itemId: string; title: string; text: string }> {
  if (items.length === 0) {
    return [{
      itemId: "show",
      title: "Intro",
      text: "今天没有新闻达到 AI 游戏日报的筛选阈值。我们明天继续追踪。"
    }];
  }

  const segments: Array<{ itemId: string; title: string; text: string }> = [{
    itemId: "show",
    title: "Intro",
    text: `大家好，今天的 AI 游戏日报精选 ${items.length} 条值得关注的消息。`
  }];

  items.forEach((item, index) => {
    segments.push({
      itemId: item.id,
      title: item.articleTitle || item.summary || "News item",
      text: `${index + 1}、${firstNonEmpty(item.articleTitle, item.summary, item.rawContent)}。${firstNonEmpty(item.introSummary, item.summary, item.articleBody)}`
    });

    if (index < items.length - 1) {
      segments.push({
        itemId: item.id,
        title: "Transition",
        text: "接着看下一条。"
      });
    }
  });

  segments.push({
    itemId: "show",
    title: "Outro",
    text: "以上就是今天的重点。更多进展，我们下一期继续更新。"
  });

  return segments;
}

export function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return [];
  }

  const sentences = normalized.match(/[^。！？!?；;.\n]+(?:[。！？!?；;.]|$)/gu) ?? [normalized];
  return sentences.map((sentence) => sentence.trim()).filter(Boolean);
}

export function renderSrt(timeline: TimelineEvent[]): string {
  return timeline
    .map((event, index) => [
      String(index + 1),
      `${formatSrtTime(event.startMs)} --> ${formatSrtTime(event.endMs)}`,
      event.text ?? event.title,
      ""
    ].join("\n"))
    .join("\n");
}

export function formatSrtTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = String(ms % 1000).padStart(3, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const minutes = String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0");
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  return `${hours}:${minutes}:${seconds},${milliseconds}`;
}

function groupByItem<T extends { itemId?: string }>(items: NewsItem[], values: T[]): Map<string, T[]> {
  const itemIds = new Set(items.map((item) => item.id));
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    if (value.itemId && itemIds.has(value.itemId)) {
      grouped.set(value.itemId, [...(grouped.get(value.itemId) ?? []), value]);
    }
  }
  return grouped;
}

function groupSrtByItem(items: NewsItem[], timeline: TimelineEvent[]): Map<string, string> {
  const grouped = groupByItem(items, timeline);
  return new Map([...grouped.entries()].map(([itemId, events]) => [itemId, renderSrt(events)]));
}

function firstNonEmpty(...values: string[]): string {
  return values.map((value) => value.trim()).find(Boolean) ?? "No details available";
}
