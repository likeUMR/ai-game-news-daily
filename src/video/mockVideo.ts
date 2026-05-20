import type { NewsItem, TimelineEvent } from "../pipeline/types.js";
import { planVideoNarration, type NarrationPlanOptions } from "./narrationPlanner.js";

export interface VideoPlan {
  mode: "mock";
  timeline: TimelineEvent[];
  subtitles: string;
  subtitlePath?: string;
  scriptSegments?: string[];
}

export async function createMockVideoPlan(
  items: NewsItem[],
  options?: Pick<NarrationPlanOptions, "generatedAt" | "outputRoot" | "repository">
): Promise<VideoPlan> {
  if (!options) {
    return createLegacyMockVideoPlan(items);
  }

  const narration = await planVideoNarration(items, {
    ...options,
    ttsProviderName: "mock"
  });

  return {
    mode: "mock",
    timeline: narration.timeline,
    subtitles: narration.subtitleSrt,
    subtitlePath: narration.subtitlePath,
    scriptSegments: narration.scriptSegments
  };
}

function createLegacyMockVideoPlan(items: NewsItem[]): VideoPlan {
  let cursor = 0;
  const timeline = items.map((item) => {
    const durationMs = Math.max(3000, item.articleBody.length * 45);
    const event = {
      itemId: item.id,
      startMs: cursor,
      endMs: cursor + durationMs,
      title: item.articleTitle
    };
    cursor += durationMs;
    return event;
  });

  return {
    mode: "mock",
    timeline,
    subtitles: renderLegacySrt(items, timeline)
  };
}

function renderLegacySrt(items: NewsItem[], timeline: TimelineEvent[]): string {
  return timeline
    .map((event, index) => {
      const item = items[index];
      return [
        String(index + 1),
        `${formatSrtTime(event.startMs)} --> ${formatSrtTime(event.endMs)}`,
        item?.introSummary ?? event.title,
        ""
      ].join("\n");
    })
    .join("\n");
}

function formatSrtTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = String(ms % 1000).padStart(3, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const minutes = String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0");
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  return `${hours}:${minutes}:${seconds},${milliseconds}`;
}
