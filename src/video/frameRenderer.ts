import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { NewsItem, TimelineEvent } from "../pipeline/types.js";

export type FrameKind = "title" | "category" | "news" | "quote-source" | "progress" | "outro";

export interface FrameDimensions {
  width: number;
  height: number;
}

export interface VideoFrame {
  id: string;
  kind: FrameKind;
  title: string;
  html: string;
  htmlPath?: string;
  pngPath?: string;
  metadata: Record<string, unknown>;
}

export interface VideoFrameRenderResult {
  htmlDir: string;
  pngDir: string;
  dimensions: FrameDimensions;
  renderer: "browser" | "placeholder";
  frames: VideoFrame[];
  error?: string;
}

export interface RenderVideoFramesOptions {
  generatedAt: string;
  outputRoot: string;
  dimensions?: Partial<FrameDimensions>;
  renderer?: "auto" | "browser" | "placeholder";
}

const defaultDimensions: FrameDimensions = {
  width: 1920,
  height: 1080
};

export async function renderVideoFrames(
  items: NewsItem[],
  timeline: TimelineEvent[],
  options: RenderVideoFramesOptions
): Promise<VideoFrameRenderResult> {
  const dimensions = { ...defaultDimensions, ...options.dimensions };
  const date = options.generatedAt.slice(0, 10);
  const frameRoot = join(options.outputRoot, date, "frames");
  const htmlDir = join(frameRoot, "html");
  const pngDir = join(frameRoot, "png");
  const frames = buildVideoFrames(items, timeline, options.generatedAt, dimensions);

  await mkdir(htmlDir, { recursive: true });
  await mkdir(pngDir, { recursive: true });

  for (const frame of frames) {
    const htmlPath = join(htmlDir, `${frame.id}.html`);
    await writeFile(htmlPath, frame.html, "utf8");
    frame.htmlPath = htmlPath;
    frame.pngPath = join(pngDir, `${frame.id}.png`);
  }

  if (options.renderer === "placeholder") {
    await writePlaceholderFrames(frames, dimensions);
    return { htmlDir, pngDir, dimensions, renderer: "placeholder", frames };
  }

  try {
    await screenshotFramesWithPlaywright(frames, dimensions);
    return { htmlDir, pngDir, dimensions, renderer: "browser", frames };
  } catch (error) {
    if (options.renderer === "browser") {
      throw error;
    }

    await writePlaceholderFrames(frames, dimensions);
    return {
      htmlDir,
      pngDir,
      dimensions,
      renderer: "placeholder",
      frames,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function buildVideoFrames(
  items: NewsItem[],
  timeline: TimelineEvent[],
  generatedAt: string,
  dimensions: FrameDimensions = defaultDimensions
): VideoFrame[] {
  const frames: VideoFrame[] = [];
  const totalDurationMs = timeline.at(-1)?.endMs ?? 0;
  const categories = new Set<string>();

  frames.push(createFrame("title", frames.length, {
    title: "AI Game News Daily",
    kicker: formatDate(generatedAt),
    body: `${items.length} selected item${items.length === 1 ? "" : "s"}`,
    dimensions,
    metadata: { generatedAt, selectedItems: items.length, totalDurationMs }
  }));

  for (const [index, item] of items.entries()) {
    if (!categories.has(item.category)) {
      categories.add(item.category);
      frames.push(createFrame("category", frames.length, {
        title: item.category || "Top Stories",
        kicker: "Category",
        body: `${items.filter((candidate) => candidate.category === item.category).length} item(s)`,
        dimensions,
        metadata: { category: item.category || "Top Stories" }
      }));
    }

    const itemTimeline = timeline.filter((event) => event.itemId === item.id);
    const startMs = itemTimeline[0]?.startMs ?? timeline[index]?.startMs ?? 0;
    const endMs = itemTimeline.at(-1)?.endMs ?? timeline[index]?.endMs ?? startMs;
    const progress = totalDurationMs > 0 ? endMs / totalDurationMs : (index + 1) / Math.max(items.length, 1);
    const itemMetadata = {
      itemId: item.id,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      category: item.category,
      timelineStartMs: startMs,
      timelineEndMs: endMs,
      itemIndex: index + 1,
      itemCount: items.length
    };

    frames.push(createFrame("news", frames.length, {
      title: firstNonEmpty(item.articleTitle, item.summary, item.rawContent),
      kicker: `${index + 1}/${items.length} · ${firstNonEmpty(item.category, "News")}`,
      body: firstNonEmpty(item.introSummary, item.summary, item.articleBody, item.rawContent),
      sourceName: item.sourceName,
      dimensions,
      metadata: itemMetadata
    }));
    frames.push(createFrame("quote-source", frames.length, {
      title: firstNonEmpty(item.sourceName, "Source"),
      kicker: "Source",
      body: firstNonEmpty(item.summary, item.articleBody, item.rawContent),
      sourceName: item.sourceUrl,
      dimensions,
      metadata: itemMetadata
    }));
    frames.push(createFrame("progress", frames.length, {
      title: firstNonEmpty(item.articleTitle, item.summary, "Story progress"),
      kicker: "Timeline",
      body: `${formatDuration(startMs)} - ${formatDuration(endMs)}`,
      progress,
      dimensions,
      metadata: { ...itemMetadata, progress }
    }));
  }

  frames.push(createFrame("outro", frames.length, {
    title: "More tomorrow",
    kicker: "End",
    body: "AI game production signals, filtered and summarized.",
    dimensions,
    metadata: { generatedAt, totalDurationMs }
  }));

  return frames;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createFrame(
  kind: FrameKind,
  index: number,
  input: {
    title: string;
    kicker: string;
    body: string;
    sourceName?: string;
    progress?: number;
    dimensions: FrameDimensions;
    metadata: Record<string, unknown>;
  }
): VideoFrame {
  const id = `${String(index + 1).padStart(4, "0")}-${kind}`;
  return {
    id,
    kind,
    title: input.title,
    html: renderFrameHtml(kind, input),
    metadata: { frameIndex: index, frameKind: kind, ...input.metadata }
  };
}

function renderFrameHtml(
  kind: FrameKind,
  input: {
    title: string;
    kicker: string;
    body: string;
    sourceName?: string;
    progress?: number;
    dimensions: FrameDimensions;
  }
): string {
  const progress = Math.max(0, Math.min(1, input.progress ?? 0));
  const kindClass = `frame-${kind}`;
  const source = input.sourceName
    ? `<div class="source">${escapeHtml(input.sourceName)}</div>`
    : "";
  const progressBar = kind === "progress"
    ? `<div class="progress-track"><div class="progress-fill" style="width:${Math.round(progress * 100)}%"></div></div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${input.dimensions.width}, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: ${input.dimensions.width}px; height: ${input.dimensions.height}px; margin: 0; overflow: hidden; }
    body { font-family: Inter, "Segoe UI", Arial, sans-serif; background: #101216; color: #f7f3e8; }
    .frame { width: 100%; height: 100%; padding: 88px 112px; display: flex; flex-direction: column; justify-content: space-between; background: linear-gradient(135deg, #101216 0%, #1c2430 54%, #25322c 100%); }
    .kicker { color: #7ee0c3; font-size: 34px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
    h1 { margin: 28px 0 0; max-width: 1440px; font-size: 92px; line-height: 1.04; letter-spacing: 0; }
    .body { max-width: 1320px; font-size: 44px; line-height: 1.28; color: #d9dfd8; }
    .source { margin-top: 28px; font-size: 30px; color: #f0bd65; overflow-wrap: anywhere; }
    .footer { display: flex; justify-content: space-between; align-items: end; color: #97a4a4; font-size: 26px; }
    .badge { padding: 14px 20px; border: 2px solid #46515c; border-radius: 8px; color: #d9dfd8; }
    .progress-track { width: 100%; height: 22px; border-radius: 8px; background: #303842; overflow: hidden; margin-top: 48px; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #7ee0c3, #f0bd65); }
    .frame-title h1, .frame-category h1, .frame-outro h1 { font-size: 118px; }
    .frame-quote-source .body { font-size: 54px; }
    .frame-progress h1 { font-size: 72px; }
  </style>
</head>
<body>
  <main class="frame ${kindClass}">
    <section>
      <div class="kicker">${escapeHtml(input.kicker)}</div>
      <h1>${escapeHtml(input.title)}</h1>
    </section>
    <section>
      <div class="body">${escapeHtml(input.body)}</div>
      ${source}
      ${progressBar}
    </section>
    <section class="footer">
      <div>AI Game News Daily</div>
      <div class="badge">${escapeHtml(kind)}</div>
    </section>
  </main>
</body>
</html>
`;
}

async function screenshotFramesWithPlaywright(frames: VideoFrame[], dimensions: FrameDimensions): Promise<void> {
  const playwright = await import("playwright-core");
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: dimensions, deviceScaleFactor: 1 });
    for (const frame of frames) {
      if (!frame.htmlPath || !frame.pngPath) {
        throw new Error(`Frame paths were not initialized for ${frame.id}`);
      }
      await page.goto(pathToFileURL(frame.htmlPath).href, { waitUntil: "networkidle" });
      await page.screenshot({ path: frame.pngPath, type: "png" });
    }
  } finally {
    await browser.close();
  }
}

async function writePlaceholderFrames(frames: VideoFrame[], dimensions: FrameDimensions): Promise<void> {
  for (const frame of frames) {
    if (!frame.pngPath) {
      throw new Error(`PNG path was not initialized for ${frame.id}`);
    }

    const svg = renderPlaceholderSvg(frame, dimensions);
    await writeFile(frame.pngPath.replace(/\.png$/u, ".svg"), svg, "utf8");
    await writeFile(frame.pngPath, createPlaceholderPng());
  }
}

function renderPlaceholderSvg(frame: VideoFrame, dimensions: FrameDimensions): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}">
  <rect width="100%" height="100%" fill="#101216"/>
  <text x="80" y="140" fill="#7ee0c3" font-family="Arial" font-size="42">${escapeHtml(frame.kind)}</text>
  <text x="80" y="240" fill="#f7f3e8" font-family="Arial" font-size="64">${escapeHtml(frame.title)}</text>
</svg>
`;
}

function createPlaceholderPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/luzfswAAAABJRU5ErkJggg==",
    "base64"
  );
}

function firstNonEmpty(...values: string[]): string {
  return values.map((value) => value.trim()).find(Boolean) ?? "";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
