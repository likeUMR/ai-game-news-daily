import type { NewsItem } from "../pipeline/types.js";
import type {
  ArticleEntryResult,
  ClassificationResult,
  GroupedArticleEntriesResult,
  KeywordsResult,
  MarkdownResult,
  RelevanceScoreResult,
  SummaryResult,
  VoiceoverScriptResult
} from "./schemas.js";

export interface AIProvider {
  classifyAndFilter(item: NewsItem, options: ClassificationOptions): Promise<ClassificationResult>;
  summarize(item: NewsItem): Promise<SummaryResult>;
  extractKeywords(item: NewsItem): Promise<KeywordsResult>;
  scoreRelevance(item: NewsItem): Promise<RelevanceScoreResult>;
  generateArticleEntry(item: NewsItem): Promise<ArticleEntryResult>;
  generateArticleEntries(groups: ArticleGenerationContextGroup[]): Promise<GroupedArticleEntriesResult>;
  formatMarkdown(items: NewsItem[], generatedAt: string): Promise<MarkdownResult>;
  generateVoiceoverScript(items: NewsItem[]): Promise<VoiceoverScriptResult>;
}

export interface ArticleGenerationContextGroup {
  category: string;
  items: NewsItem[];
}

export interface ClassificationOptions {
  minCrossRelevanceScore: number;
}
