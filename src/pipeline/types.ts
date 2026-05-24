export type SourceType = "ai_media" | "game_media" | "ai_game_media" | "official" | "community";

export interface NewsItem {
  id: string;
  rawItemId?: string | null;
  sourceUrl: string;
  sourceName: string;
  sourceType: SourceType;
  sourceWeight: number;
  publishedAt: string;
  collectedAt: string;
  rawContent: string;
  summary: string;
  keywords: string[];
  category: string;
  score: number;
  newsValueScore: number;
  duplicateOf: string | null;
  selected: boolean;
  isMock?: boolean;
  officialSources: string[];
  articleTitle: string;
  articleBody: string;
  introSummary: string;
  assets: string[];
  scriptSegments: string[];
  ttsSegments: TtsSegment[];
  timeline: TimelineEvent[];
  subtitleSrt: string;
  aiRelevanceScore: number;
  gameRelevanceScore: number;
  crossRelevanceScore: number;
  aiTags: string[];
  gameTags: string[];
  isTopicCandidate: boolean;
  exclusionReason: string;
}

export interface TtsSegment {
  id?: string;
  itemId?: string;
  scriptSegmentIndex?: number;
  text: string;
  durationMs: number;
  audioPath: string;
  startMs?: number;
  endMs?: number;
}

export interface TimelineEvent {
  itemId: string;
  ttsSegmentId?: string;
  startMs: number;
  endMs: number;
  title: string;
  text?: string;
  audioPath?: string;
}

export interface PipelineResult {
  generatedAt: string;
  runId?: string;
  enrichedItems: NewsItem[];
  selectedItems: NewsItem[];
  auditPath: string;
  collectionAuditPath?: string;
  markdownPath: string;
  videoPlanPath: string;
  videoPath?: string;
  videoCompositionAuditPath?: string;
  distributionDir?: string;
  distributionManifestPath?: string;
  frameHtmlDir: string;
  framePngDir: string;
  runPath: string;
}
