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
  officialSources: z.array(z.string().url()).default([])
});

export const groupedArticleEntrySchema = z.object({
  id: z.string().min(1),
  articleTitle: z.string().min(1),
  articleBody: z.string().min(1),
  introSummary: z.string().min(1),
  sourceLinks: z.array(z.string().url()).min(1)
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
  const jsonText = extractJsonText(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new AIResponseValidationError("AI response did not contain valid JSON.", error);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".") || "response"}: ${issue.message}`)
      .join("\n");
    throw new AIResponseValidationError(`AI response failed schema validation:\n${details}`, result.error);
  }

  return result.data;
}

function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length === 0) {
    throw new AIResponseValidationError("AI response did not contain a JSON object or array.");
  }

  const start = Math.min(...starts);
  const opening = trimmed[start];
  const closing = opening === "{" ? "}" : "]";
  const end = trimmed.lastIndexOf(closing);
  if (end < start) {
    throw new AIResponseValidationError("AI response JSON was incomplete.");
  }

  return trimmed.slice(start, end + 1);
}
