import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NewsItem } from "../pipeline/types.js";

export const DISTRIBUTION_PLATFORMS = [
  "bilibili",
  "youtube",
  "wechat",
  "zhihu",
  "xiaohongshu",
  "douyin"
] as const;

export type DistributionPlatform = typeof DISTRIBUTION_PLATFORMS[number];

export interface DistributionExportInput {
  generatedAt: string;
  outputRoot: string;
  items: NewsItem[];
  markdownPath: string;
  videoPath?: string;
  subtitlePath?: string;
}

export interface PlatformLengthLimits {
  titleCharacters?: number;
  descriptionCharacters?: number;
  tags?: number;
  videoDurationSeconds?: number;
  notes?: string;
}

export interface PlatformMetadata {
  platform: DistributionPlatform;
  title: string;
  description: string;
  tags: string[];
  sourceLinks: Array<{ label: string; url: string }>;
  subtitlePath: string | null;
  videoPath: string | null;
  contentPath: string | null;
  lengthLimits: PlatformLengthLimits;
  upload: {
    preparedOnly: true;
    credentialFree: true;
    requiresManualPublishing: true;
  };
}

export interface DistributionExportResult {
  distributionDir: string;
  manifestPath: string;
  packages: Array<{
    platform: DistributionPlatform;
    directory: string;
    metadataPath: string;
  }>;
}

export interface PlatformConfig {
  platform: DistributionPlatform;
  supportsVideo: boolean;
  supportsSubtitles: boolean;
  contentPathKind: "markdown" | "none";
  lengthLimits: PlatformLengthLimits;
}

const PLATFORM_CONFIGS: PlatformConfig[] = [
  {
    platform: "bilibili",
    supportsVideo: true,
    supportsSubtitles: true,
    contentPathKind: "none",
    lengthLimits: { descriptionCharacters: 2000, tags: 12, notes: "Bilibili description limit enforced locally." }
  },
  {
    platform: "youtube",
    supportsVideo: true,
    supportsSubtitles: true,
    contentPathKind: "none",
    lengthLimits: { titleCharacters: 100, descriptionCharacters: 5000, tags: 500, notes: "YouTube description limit enforced locally." }
  },
  {
    platform: "wechat",
    supportsVideo: false,
    supportsSubtitles: false,
    contentPathKind: "markdown",
    lengthLimits: { notes: "No local platform limit is enforced by this credential-free package step." }
  },
  {
    platform: "zhihu",
    supportsVideo: false,
    supportsSubtitles: false,
    contentPathKind: "markdown",
    lengthLimits: { notes: "No local platform limit is enforced by this credential-free package step." }
  },
  {
    platform: "xiaohongshu",
    supportsVideo: true,
    supportsSubtitles: false,
    contentPathKind: "markdown",
    lengthLimits: { notes: "No local platform limit is enforced by this credential-free package step." }
  },
  {
    platform: "douyin",
    supportsVideo: true,
    supportsSubtitles: false,
    contentPathKind: "none",
    lengthLimits: { notes: "No local platform limit is enforced by this credential-free package step." }
  }
];

export async function createDistributionExportPackages(input: DistributionExportInput): Promise<DistributionExportResult> {
  const date = input.generatedAt.slice(0, 10);
  const distributionDir = join(input.outputRoot, date, "distribution");
  await mkdir(distributionDir, { recursive: true });

  const packages: DistributionExportResult["packages"] = [];
  for (const config of PLATFORM_CONFIGS) {
    const directory = join(distributionDir, config.platform);
    await mkdir(directory, { recursive: true });

    const metadata = createPlatformMetadata(config, input);
    validatePlatformMetadata(metadata);

    const metadataPath = join(directory, "metadata.json");
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    packages.push({ platform: config.platform, directory, metadataPath });
  }

  const manifestPath = join(distributionDir, "manifest.json");
  const manifest = {
    generatedAt: input.generatedAt,
    preparedOnly: true,
    credentialFree: true,
    note: "Distribution packages are local handoff artifacts only; no platform upload was attempted.",
    packages
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { distributionDir, manifestPath, packages };
}

export function createPlatformMetadata(config: PlatformConfig, input: DistributionExportInput): PlatformMetadata {
  const title = clampPlatformTitle(createTitle(input.generatedAt, input.items), config.lengthLimits.titleCharacters);
  const tags = createTags(input.items);
  const sourceLinks = createSourceLinks(input.items);
  const description = clampPlatformDescription(createDescription(input.items, sourceLinks), config.lengthLimits.descriptionCharacters);

  return {
    platform: config.platform,
    title,
    description,
    tags,
    sourceLinks,
    subtitlePath: config.supportsSubtitles ? input.subtitlePath ?? null : null,
    videoPath: config.supportsVideo ? input.videoPath ?? null : null,
    contentPath: config.contentPathKind === "markdown" ? input.markdownPath : null,
    lengthLimits: config.lengthLimits,
    upload: {
      preparedOnly: true,
      credentialFree: true,
      requiresManualPublishing: true
    }
  };
}

export function validatePlatformMetadata(metadata: Pick<PlatformMetadata, "platform" | "title" | "description" | "lengthLimits">): void {
  const titleLimit = metadata.lengthLimits.titleCharacters;
  if (titleLimit !== undefined) {
    const titleLength = countCharacters(metadata.title);
    if (titleLength > titleLimit) {
      throw new Error(`${metadata.platform} title is ${titleLength} characters; limit is ${titleLimit}.`);
    }
  }

  const descriptionLimit = metadata.lengthLimits.descriptionCharacters;
  if (descriptionLimit !== undefined) {
    const descriptionLength = countCharacters(metadata.description);
    if (descriptionLength > descriptionLimit) {
      throw new Error(`${metadata.platform} description is ${descriptionLength} characters; limit is ${descriptionLimit}.`);
    }
  }
}

function createTitle(generatedAt: string, items: NewsItem[]): string {
  const date = generatedAt.slice(0, 10);
  const firstTitle = items[0]?.articleTitle.trim();
  return firstTitle ? `${date} AI + Game News Daily: ${firstTitle}` : `${date} AI + Game News Daily`;
}

function createDescription(items: NewsItem[], sourceLinks: Array<{ label: string; url: string }>): string {
  const lines = [
    "AI + Game News Daily packaged for manual publishing.",
    "",
    "Top stories:",
    ...items.map((item, index) => `${index + 1}. ${item.articleTitle} - ${firstNonEmpty(item.introSummary, item.summary)}`),
    "",
    "Sources:",
    ...sourceLinks.map((source, index) => `${index + 1}. ${source.label}: ${source.url}`),
    "",
    "Prepared locally without credentials or platform upload calls."
  ];
  return `${lines.join("\n").trim()}\n`;
}

function createTags(items: NewsItem[]): string[] {
  const tags = new Set(["AI", "Game", "News"]);
  for (const item of items) {
    for (const tag of [...item.aiTags, ...item.gameTags, ...item.keywords]) {
      const normalized = tag.trim();
      if (normalized) {
        tags.add(normalized);
      }
    }
  }
  return [...tags].slice(0, 20);
}

function clampPlatformTitle(title: string, limit: number | undefined): string {
  if (limit === undefined || countCharacters(title) <= limit) {
    return title;
  }

  if (limit <= 3) {
    return [...title].slice(0, limit).join("");
  }

  return `${[...title].slice(0, limit - 3).join("").trimEnd()}...`;
}

function clampPlatformDescription(description: string, limit: number | undefined): string {
  if (limit === undefined || countCharacters(description) <= limit) {
    return description;
  }

  if (limit <= 3) {
    return [...description].slice(0, limit).join("");
  }

  return `${[...description].slice(0, limit - 3).join("").trimEnd()}...`;
}

function createSourceLinks(items: NewsItem[]): Array<{ label: string; url: string }> {
  const links = new Map<string, { label: string; url: string }>();
  for (const item of items) {
    for (const [label, url] of [
      [item.sourceName, item.sourceUrl],
      ...item.officialSources.map((source, index) => [`Official ${index + 1}`, source] as const)
    ] as const) {
      if (!isHttpUrl(url)) {
        continue;
      }
      const canonical = canonicalizeUrl(url);
      if (!links.has(canonical)) {
        links.set(canonical, { label: label || url, url });
      }
    }
  }
  return [...links.values()];
}

function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/$/u, "");
  } catch {
    return url.trim().toLowerCase();
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function firstNonEmpty(...values: string[]): string {
  return values.map((value) => value.trim()).find(Boolean) ?? "No summary was generated.";
}

function countCharacters(value: string): number {
  return [...value].length;
}
