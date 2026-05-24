import { z } from "zod";
import type { SourceType } from "../pipeline/types.js";

const sourceNameCorrections: Record<string, string> = {
  gcores: "机核",
  chuapp: "触乐",
  youxituoluo: "游戏陀螺",
  youxichaguan: "游戏茶馆",
  gamersky: "游民星空",
  yystv: "游研社",
  "sjyx-luosiji": "罗斯基",
  youxiputao: "游戏葡萄"
};

export const sourceTypeSchema = z.enum(["ai_media", "game_media", "ai_game_media", "official", "community"]);
export const sourceGroupSchema = z.enum(["ai_native", "game_native", "ai_x_game", "official_community", "manual"]);
export const prioritySchema = z.enum(["high", "medium", "low"]);
export const collectionStrategySchema = z.enum([
  "rss",
  "rsshub",
  "web_page",
  "json_api",
  "x_social",
  "manual_markdown",
  "official_site",
  "community_submission"
]);

export const sourceDefinitionSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  url: z.string().url().optional(),
  source_group: sourceGroupSchema,
  source_type: sourceTypeSchema,
  priority: prioritySchema,
  source_weight: z.number().int().min(1).max(100),
  suggested_frequency: z.string().min(1),
  collection_strategy: collectionStrategySchema,
  max_items_per_window: z.number().int().positive().max(1000).optional(),
  notes: z.string().min(1).optional()
});

export type SourceDefinition = z.infer<typeof sourceDefinitionSchema> & {
  source_type: SourceType;
};

export const sourceRegistry = [
  {
    id: "x-ai-company-accounts",
    name: "X AI company accounts",
    source_group: "ai_native",
    source_type: "ai_media",
    priority: "high",
    source_weight: 88,
    suggested_frequency: "hourly during collection window",
    collection_strategy: "x_social",
    max_items_per_window: 80,
    notes: "Frontier AI company, lab, and product team posts called out as high-value social sources."
  },
  {
    id: "ai-company-blogs",
    name: "AI company blogs",
    source_group: "ai_native",
    source_type: "official",
    priority: "high",
    source_weight: 92,
    suggested_frequency: "daily",
    collection_strategy: "rss",
    max_items_per_window: 40,
    notes: "Official model, product, platform, and policy updates."
  },
  {
    id: "open-source-ai-releases",
    name: "Open-source AI project releases",
    source_group: "ai_native",
    source_type: "community",
    priority: "medium",
    source_weight: 72,
    suggested_frequency: "daily",
    collection_strategy: "rsshub",
    max_items_per_window: 40,
    notes: "Community release feeds for models, agents, and developer tools."
  },
  {
    id: "gamelook-ai",
    name: "GameLook AI",
    url: "http://www.gamelook.com.cn/tag/ai/feed/",
    source_group: "ai_x_game",
    source_type: "ai_game_media",
    priority: "high",
    source_weight: 95,
    suggested_frequency: "weekly, monitored daily",
    collection_strategy: "rss",
    max_items_per_window: 10,
    notes: "Low volume but directly focused on AI x game industry coverage via the tag RSS feed."
  },
  {
    id: "game-company-ai-announcements",
    name: "Game company AI announcements",
    source_group: "ai_x_game",
    source_type: "official",
    priority: "high",
    source_weight: 90,
    suggested_frequency: "daily",
    collection_strategy: "official_site",
    max_items_per_window: 30,
    notes: "Official AI tooling, strategy, partnership, and organization updates from game companies."
  },
  {
    id: "aigc-game-startups",
    name: "AIGC game startup announcements",
    source_group: "ai_x_game",
    source_type: "official",
    priority: "medium",
    source_weight: 82,
    suggested_frequency: "daily",
    collection_strategy: "official_site",
    max_items_per_window: 25,
    notes: "Startup updates around AI NPCs, art, audio, narrative, testing, publishing, and marketing."
  },
  {
    id: "gamelook",
    name: "GameLook",
    url: "http://www.gamelook.com.cn/feed/",
    source_group: "game_native",
    source_type: "game_media",
    priority: "high",
    source_weight: 88,
    suggested_frequency: "daily, about 5 game news items",
    collection_strategy: "rss",
    max_items_per_window: 25,
    notes: "Industry, company, commercial, and analysis-oriented coverage via the main site RSS feed."
  },
  {
    id: "gcores",
    name: "机核",
    url: "https://www.gcores.com/news",
    source_group: "game_native",
    source_type: "community",
    priority: "high",
    source_weight: 82,
    suggested_frequency: "daily, about 4 game news items plus weekly roundup",
    collection_strategy: "web_page",
    max_items_per_window: 20,
    notes: "Editorial coverage with strong community influence, collected from the /news HTML listing."
  },
  {
    id: "chuapp",
    name: "触乐",
    url: "https://www.chuapp.com/category/index/id/daily/p/1.html",
    source_group: "game_native",
    source_type: "game_media",
    priority: "high",
    source_weight: 84,
    suggested_frequency: "daily, about 1 game news item plus weekly AI industry events",
    collection_strategy: "web_page",
    max_items_per_window: 12,
    notes: "Higher-quality articles and industry observation, collected from the Daily HTML listing."
  },
  {
    id: "youxituoluo",
    name: "游戏陀螺",
    url: "https://www.youxituoluo.com/",
    source_group: "game_native",
    source_type: "game_media",
    priority: "medium",
    source_weight: 74,
    suggested_frequency: "daily, about 2 game news items",
    collection_strategy: "json_api",
    max_items_per_window: 50,
    notes: "Industry, publishing, and commercial dynamics."
  },
  {
    id: "youxichaguan",
    name: "游戏茶馆",
    url: "https://youxichaguan.com/feed",
    source_group: "game_native",
    source_type: "game_media",
    priority: "medium",
    source_weight: 72,
    suggested_frequency: "daily, about 5 game news items",
    collection_strategy: "rss",
    max_items_per_window: 25,
    notes: "Industry observation from a practitioner angle, collected from the site RSS feed."
  },
  {
    id: "gamersky",
    name: "游民星空",
    url: "https://www.gamersky.com/news/",
    source_group: "game_native",
    source_type: "game_media",
    priority: "low",
    source_weight: 48,
    suggested_frequency: "daily high-volume radar, filtered for AI or industry signals",
    collection_strategy: "json_api",
    max_items_per_window: 80,
    notes: "Broad game news flow; prefilter obvious gossip and only keep AI or industry-relevant items."
  },
  {
    id: "yystv",
    name: "游研社",
    url: "https://www.yystv.cn/rss/feed",
    source_group: "game_native",
    source_type: "game_media",
    priority: "high",
    source_weight: 86,
    suggested_frequency: "daily, about 3 game news items",
    collection_strategy: "rss",
    max_items_per_window: 18,
    notes: "High-quality content useful for trend and discussion signals, collected from the RSS feed."
  },
  {
    id: "sjyx-luosiji",
    name: "罗斯基",
    url: "http://www.sjyx.com/category/lsj",
    source_group: "game_native",
    source_type: "game_media",
    priority: "medium",
    source_weight: 68,
    suggested_frequency: "daily average, about 1 item",
    collection_strategy: "community_submission",
    max_items_per_window: 10,
    notes: "Supplemental source kept out of automated collection until a stable public entry is confirmed."
  },
  {
    id: "3dm",
    name: "3DM",
    url: "https://www.3dmgame.com/news_all_1/",
    source_group: "game_native",
    source_type: "game_media",
    priority: "low",
    source_weight: 45,
    suggested_frequency: "daily high-volume radar, filtered for AI-related development signals",
    collection_strategy: "web_page",
    max_items_per_window: 80,
    notes: "Very high volume and noisy; only keep items with AI or engine-development relevance."
  },
  {
    id: "youxiputao",
    name: "游戏葡萄",
    source_group: "game_native",
    source_type: "game_media",
    priority: "high",
    source_weight: 88,
    suggested_frequency: "daily, about 3 items",
    collection_strategy: "manual_markdown",
    max_items_per_window: 15,
    notes: "High-quality industry depth source, primarily distributed through WeChat official account."
  },
  {
    id: "wechat-manual-clips",
    name: "WeChat manual clips",
    source_group: "manual",
    source_type: "community",
    priority: "high",
    source_weight: 78,
    suggested_frequency: "manual as submitted",
    collection_strategy: "manual_markdown",
    max_items_per_window: 30,
    notes: "Manual Markdown intake for WeChat, user submissions, comments, private messages, and community leads."
  },
  {
    id: "developer-community-submissions",
    name: "Developer community submissions",
    source_group: "official_community",
    source_type: "community",
    priority: "medium",
    source_weight: 66,
    suggested_frequency: "manual as submitted",
    collection_strategy: "community_submission",
    max_items_per_window: 30,
    notes: "Developer posts and reader leads that RSS and ordinary web collection may miss."
  }
] satisfies SourceDefinition[];

export function validateSourceRegistry(sources: unknown = sourceRegistry): SourceDefinition[] {
  const result = z.array(sourceDefinitionSchema).safeParse(sources);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".") || "sources"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid source registry:\n${details}`);
  }

  const ids = new Set<string>();
  const names = new Set<string>();

  for (const source of result.data) {
    if (ids.has(source.id)) {
      throw new Error(`Invalid source registry:\n- duplicate source id: ${source.id}`);
    }
    ids.add(source.id);

    const sourceName = sourceNameCorrections[source.id] ?? source.name;
    if (names.has(sourceName)) {
      throw new Error(`Invalid source registry:\n- duplicate source name: ${sourceName}`);
    }
    names.add(sourceName);
  }

  return result.data.map((source) => ({
    ...source,
    name: sourceNameCorrections[source.id] ?? source.name
  })) as SourceDefinition[];
}

export function getSourceRegistry(): SourceDefinition[] {
  return validateSourceRegistry(sourceRegistry);
}
