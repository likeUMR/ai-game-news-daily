import type { SourceDefinition } from "../config/sourceRegistry.js";
import type { SourceType } from "../pipeline/types.js";

export interface RawCollectedItem {
  title: string;
  url: string;
  source_name: string;
  source_type: SourceType;
  published_at: string;
  collected_at: string;
  author: string | null;
  excerpt: string;
  raw_content: string;
  metadata: Record<string, unknown>;
}

export interface CollectorFailure {
  sourceId: string;
  sourceName: string;
  collector: string;
  error: string;
}

export interface CollectionResult {
  items: RawCollectedItem[];
  failures: CollectorFailure[];
}

export interface Collector {
  readonly name: string;
  collect(sources: SourceDefinition[], now?: Date): Promise<CollectionResult>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
