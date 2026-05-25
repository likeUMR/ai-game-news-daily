import { z } from "zod";

export const scoreSchema = z.number().int().min(0).max(100);

export const classificationSchema = z.object({
  newsValueScore: scoreSchema,
  aiRelevanceScore: scoreSchema,
  gameRelevanceScore: scoreSchema,
  crossRelevanceScore: scoreSchema,
  isTopicCandidate: z.boolean(),
  exclusionReasons: z.array(z.string()),
  aiTags: z.array(z.string()),
  gameTags: z.array(z.string())
});

export const summarySchema = z.object({
  summary: z.string().min(1),
  introSummary: z.string().min(1)
});

export const keywordsSchema = z.object({
  keywords: z.array(z.string().min(1)).max(20)
});

export const relevanceScoreSchema = z.object({
  aiRelevanceScore: scoreSchema,
  gameRelevanceScore: scoreSchema,
  crossRelevanceScore: scoreSchema
});

export const articleEntrySchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  category: z.string().min(1),
  officialSources: z.array(z.string()).default([])
});

export const groupedArticleEntrySchema = z.object({
  id: z.string().min(1),
  articleTitle: z.string().min(1),
  articleBody: z.string().min(1),
  introSummary: z.string().min(1),
  sourceLinks: z.array(z.string())
});

export const groupedArticleEntriesSchema = z.object({
  entries: z.array(groupedArticleEntrySchema)
});

export const markdownSchema = z.object({
  markdown: z.string().min(1)
});

export const voiceoverScriptSchema = z.object({
  segments: z.array(z.string().min(1)).min(1)
});

export type ClassificationResult = z.infer<typeof classificationSchema>;
export type SummaryResult = z.infer<typeof summarySchema>;
export type KeywordsResult = z.infer<typeof keywordsSchema>;
export type RelevanceScoreResult = z.infer<typeof relevanceScoreSchema>;
export type ArticleEntryResult = z.infer<typeof articleEntrySchema>;
export type GroupedArticleEntryResult = z.infer<typeof groupedArticleEntrySchema>;
export type GroupedArticleEntriesResult = z.infer<typeof groupedArticleEntriesSchema>;
export type MarkdownResult = z.infer<typeof markdownSchema>;
export type VoiceoverScriptResult = z.infer<typeof voiceoverScriptSchema>;

export class AIResponseValidationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AIResponseValidationError";
  }
}

export function parseAiJsonResponse<T>(raw: string, schema: z.ZodType<T>): T {
  const jsonTexts = extractJsonTexts(raw);
  let lastSchemaError: z.ZodError | null = null;

  for (const jsonText of jsonTexts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }

    const result = schema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    lastSchemaError = result.error;

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const entryResult = schema.safeParse(entry);
        if (entryResult.success) {
          return entryResult.data;
        }
        lastSchemaError = entryResult.error;
      }
    }
  }

  if (lastSchemaError) {
    throw new AIResponseValidationError(formatSchemaError(lastSchemaError), lastSchemaError);
  }

  throw new AIResponseValidationError("AI response did not contain valid JSON.");
}

function extractJsonTexts(raw: string): string[] {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced?.[1]) {
    return [fenced[1].trim()];
  }

  const segments = findBalancedJsonSegments(trimmed);
  if (segments.length === 0) {
    throw new AIResponseValidationError("AI response did not contain a complete JSON object or array.");
  }

  return segments;
}

function findBalancedJsonSegments(raw: string): string[] {
  const segments: string[] = [];

  for (let start = 0; start < raw.length; start += 1) {
    const opening = raw[start];
    if (opening !== "{" && opening !== "[") {
      continue;
    }

    const closing = opening === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === opening) {
        depth += 1;
        continue;
      }

      if (char === closing) {
        depth -= 1;
        if (depth === 0) {
          segments.push(raw.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }

  return segments;
}

function formatSchemaError(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `- ${issue.path.join(".") || "response"}: ${issue.message}`)
    .join("\n");
  return `AI response failed schema validation:\n${details}`;
}

