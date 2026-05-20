import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SourceDefinition } from "../config/sourceRegistry.js";
import type { CollectionResult, Collector, RawCollectedItem } from "./types.js";
import { normalizeCollectedUrl } from "./url.js";

export interface MarkdownCollectorOptions {
  manualDir: string;
}

export class MarkdownCollector implements Collector {
  readonly name = "manual_markdown";

  constructor(private readonly options: MarkdownCollectorOptions) {}

  async collect(sources: SourceDefinition[], now = new Date()): Promise<CollectionResult> {
    const manualSource = sources.find((source) => source.collection_strategy === "manual_markdown");
    const sourceName = manualSource?.name ?? "Manual Markdown";
    const sourceType = manualSource?.source_type ?? "community";
    const collectedAt = now.toISOString();

    try {
      const filenames = (await readdir(this.options.manualDir)).filter((name) => name.endsWith(".md")).sort();
      const items = await Promise.all(
        filenames.map(async (filename): Promise<RawCollectedItem> => {
          const filePath = join(this.options.manualDir, filename);
          const content = await readFile(filePath, "utf8");
          const parsed = parseMarkdownSubmission(content);
          const title = parsed.frontmatter.title ?? readFirstHeading(parsed.body) ?? basename(filename, ".md");
          const rawUrl = parsed.frontmatter.source_url ?? `manual://${filename}`;
          const url = normalizeCollectedUrl(rawUrl) ?? rawUrl;
          const publishedAt = parseDate(parsed.frontmatter.published_at) ?? collectedAt;
          const tags = parseTags(parsed.frontmatter.tags);

          return {
            title,
            url,
            source_name: parsed.frontmatter.source_name ?? sourceName,
            source_type: sourceType,
            published_at: publishedAt,
            collected_at: collectedAt,
            author: parsed.frontmatter.author ?? null,
            excerpt: createExcerpt(parsed.body),
            raw_content: parsed.body.trim(),
            metadata: {
              collector: this.name,
              source_id: manualSource?.id ?? "manual-markdown",
              file_path: filePath,
              tags
            }
          };
        })
      );

      return { items, failures: [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { items: [], failures: [] };
      }

      return {
        items: [],
        failures: [{
          sourceId: manualSource?.id ?? "manual-markdown",
          sourceName,
          collector: this.name,
          error: error instanceof Error ? error.message : String(error)
        }]
      };
    }
  }
}

export function parseMarkdownSubmission(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: {}, body: content };
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    frontmatter[key] = value;
  }

  return { frontmatter, body: match[2] ?? "" };
}

function readFirstHeading(body: string): string | null {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

function createExcerpt(body: string): string {
  return body
    .replace(/^#.+$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

function parseDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function parseTags(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((tag) => tag.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}
