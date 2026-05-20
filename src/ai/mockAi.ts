import type { NewsItem } from "../pipeline/types.js";
import { enrichWithProvider, MockAIProvider } from "./mockProvider.js";

export interface EnrichmentOptions {
  minCrossRelevanceScore: number;
}

export async function enrichWithMockAi(items: NewsItem[], options: EnrichmentOptions): Promise<NewsItem[]> {
  return enrichWithProvider(new MockAIProvider(), items, options);
}
