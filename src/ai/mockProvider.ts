import { renderDailyMarkdown } from "../render/markdownRenderer.js";
import type { NewsItem } from "../pipeline/types.js";
import type { AIProvider, ArticleGenerationContextGroup, ClassificationOptions } from "./types.js";
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

export class MockAIProvider implements AIProvider {
  async classifyAndFilter(item: NewsItem, options: ClassificationOptions): Promise<ClassificationResult> {
    const scores = await this.scoreRelevance(item);
    const content = normalizeText(item);
    const lowInformation = isLowInformationItem(item.rawContent);
    const newsValueScore = content.includes("repost") || lowInformation
      ? 35
      : scoreNewsValue(item, scores);
    const exclusionReasons = inferMockExclusions(content, scores, newsValueScore, options.minCrossRelevanceScore);
    if (lowInformation) {
      exclusionReasons.unshift("low-information item");
    }
    const isTopicCandidate = exclusionReasons.length === 0;

    return {
      newsValueScore,
      ...scores,
      isTopicCandidate,
      exclusionReasons,
      aiTags: scores.aiRelevanceScore > 50 ? ["tooling", "workflow"] : [],
      gameTags: scores.gameRelevanceScore > 50 ? ["development", "operations"] : []
    };
  }

  async summarize(item: NewsItem): Promise<SummaryResult> {
    const content = compactContent(item.rawContent.trim());
    const title = item.articleTitle.trim();
    const summary = buildSummary(title, content);
    const scores = await this.scoreRelevance(item);

    return {
      summary,
      introSummary: buildIntroSummary(title, content, scores)
    };
  }

  async extractKeywords(item: NewsItem): Promise<KeywordsResult> {
    const scores = await this.scoreRelevance(item);
    return {
      keywords: extractKeywordSignals(item, scores)
    };
  }

  async scoreRelevance(item: NewsItem): Promise<RelevanceScoreResult> {
    const content = normalizeText(item);
    const aiHits = countKeywordHits(content, aiSignals);
    const gameHits = countKeywordHits(content, gameSignals);
    const crossHits = countKeywordHits(content, crossSignals);
    const aiRelevanceScore = clampScore(aiHits === 0 ? 12 : 25 + (aiHits * 20) + (crossHits * 6));
    const gameRelevanceScore = clampScore(gameHits === 0 ? 20 : 30 + (gameHits * 14) + (crossHits * 6));
    const crossRelevanceScore = clampScore(
      aiHits === 0 || gameHits === 0
        ? Math.round((aiRelevanceScore * 0.35) + (gameRelevanceScore * 0.25))
        : Math.round((aiRelevanceScore * 0.45) + (gameRelevanceScore * 0.35) + (crossHits * 8) + ((item.sourceWeight - 50) * 0.08))
    );

    return {
      aiRelevanceScore,
      gameRelevanceScore,
      crossRelevanceScore
    };
  }

  async generateArticleEntry(item: NewsItem): Promise<ArticleEntryResult> {
    const scores = await this.scoreRelevance(item);
    const isTopicCandidate = scores.crossRelevanceScore >= 60;
    const title = item.articleTitle.trim() || deriveTitle(item.rawContent);
    const content = compactContent(item.rawContent);

    return {
      title: title || (isTopicCandidate ? "AI x game update" : "Game industry update"),
      body: isTopicCandidate
        ? buildArticleBody(title, content)
        : `This item stayed in the collection pool but did not clear the AI x game daily threshold. Original note: ${content.slice(0, 140)}${content.length > 140 ? "..." : ""}`,
      category: classifyCategory(scores),
      officialSources: [item.sourceUrl]
    };
  }

  async generateArticleEntries(groups: ArticleGenerationContextGroup[]): Promise<GroupedArticleEntriesResult> {
    return {
      entries: groups.flatMap((group) => group.items.map((item) => ({
        id: item.id,
        articleTitle: item.articleTitle || deriveTitle(item.rawContent) || `${group.category} update`,
        articleBody: buildFinalSummary(item),
        introSummary: buildFinalCommentary(item),
        sourceLinks: [...new Set([item.sourceUrl, ...item.officialSources].filter(Boolean))]
      })))
    };
  }

  async formatMarkdown(items: NewsItem[], generatedAt: string): Promise<MarkdownResult> {
    return {
      markdown: renderDailyMarkdown(items, generatedAt)
    };
  }

  async generateVoiceoverScript(items: NewsItem[]): Promise<VoiceoverScriptResult> {
    const segments = items.length === 0
      ? ["No AI and game topic candidates met today's threshold."]
      : items.map((item) => `${item.articleTitle}. ${item.introSummary || item.summary}`);

    return { segments };
  }
}

function inferMockExclusions(
  content: string,
  scores: RelevanceScoreResult,
  newsValueScore: number,
  minCrossRelevanceScore: number
): string[] {
  if (/\b(tutorial|how to|guide|tips)\b/.test(content)) {
    return ["generic tutorial"];
  }
  if (/\b(celebrity|rumor|gossip|cosplay|meme)\b/.test(content)) {
    return ["pure entertainment gossip"];
  }
  if (content.includes("repost") || content.length < 50) {
    return ["low-information repost"];
  }
  if (scores.aiRelevanceScore < 40 && scores.gameRelevanceScore >= 45) {
    return ["non-ai game news"];
  }
  if (scores.crossRelevanceScore < minCrossRelevanceScore) {
    return ["low cross relevance"];
  }
  if (newsValueScore < 55) {
    return ["low news value"];
  }
  return [];
}

interface SignalDefinition {
  label: string;
  pattern: RegExp;
}

const aiSignals: SignalDefinition[] = [
  { label: "AI", pattern: /\bai\b/i },
  { label: "AIGC", pattern: /\baigc\b/i },
  { label: "LLM", pattern: /\bllm\b/i },
  { label: "Agent", pattern: /\bagents?\b/i },
  { label: "人工智能", pattern: /人工智能/ },
  { label: "生成式", pattern: /生成式/ },
  { label: "大模型", pattern: /大模型/ },
  { label: "智能体", pattern: /智能体/ },
  { label: "机器学习", pattern: /机器学习/ },
  { label: "文本生成", pattern: /文本生成/ },
  { label: "图像生成", pattern: /图像生成/ },
  { label: "语音生成", pattern: /语音生成/ }
];

const gameSignals: SignalDefinition[] = [
  { label: "game", pattern: /\bgames?\b/i },
  { label: "gaming", pattern: /\bgaming\b/i },
  { label: "studio", pattern: /\bstudio\b/i },
  { label: "engine", pattern: /\bengine\b/i },
  { label: "NPC", pattern: /\bnpc\b/i },
  { label: "Roblox", pattern: /\broblox\b/i },
  { label: "Steam", pattern: /\bsteam\b/i },
  { label: "游戏", pattern: /游戏/ },
  { label: "手游", pattern: /手游/ },
  { label: "端游", pattern: /端游/ },
  { label: "主机", pattern: /主机/ },
  { label: "厂商", pattern: /厂商/ },
  { label: "工作室", pattern: /工作室/ },
  { label: "发行", pattern: /发行/ },
  { label: "研发", pattern: /研发/ },
  { label: "开发者", pattern: /开发者/ },
  { label: "引擎", pattern: /引擎/ },
  { label: "互动娱乐", pattern: /互动娱乐/ }
];

const crossSignals: SignalDefinition[] = [
  { label: "AI x 游戏", pattern: /ai游戏|游戏ai|ai x game|游戏\s*\+\s*ai/i },
  { label: "游戏开发", pattern: /游戏开发/ },
  { label: "通用游戏AI", pattern: /通用游戏ai/i },
  { label: "游戏画面", pattern: /游戏画面/ },
  { label: "智能NPC", pattern: /智能npc/i },
  { label: "AI生成", pattern: /ai生成/i },
  { label: "游戏生产", pattern: /游戏生产/ },
  { label: "游戏工业化", pattern: /游戏工业化/ }
];

function normalizeText(item: NewsItem): string {
  return `${item.articleTitle}\n${item.rawContent}`.toLowerCase();
}

function compactContent(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isLowInformationItem(value: string): boolean {
  const compact = compactContent(value);
  const sentenceCount = compact.split(/[。！？.!?]\s*|\n+/u).filter((part) => part.trim().length > 0).length;
  return compact.length < 160 || sentenceCount < 3;
}

function buildSummary(title: string, content: string): string {
  const merged = [title, content].filter(Boolean).join("：");
  return merged.length > 140 ? `${merged.slice(0, 137).trimEnd()}...` : merged;
}

function buildIntroSummary(title: string, content: string, scores: RelevanceScoreResult): string {
  const subject = title || deriveTitle(content) || "\u8be5\u6761\u52a8\u6001";
  if (scores.crossRelevanceScore >= 70) {
    return `${subject}\u805a\u7126 AI \u4e0e\u6e38\u620f\u7ed3\u5408\u7684\u843d\u5730\u4fe1\u53f7\u3002`;
  }
  if (scores.aiRelevanceScore >= 60) {
    return `${subject}\u66f4\u504f AI \u65b9\u5411\uff0c\u548c\u6e38\u620f\u573a\u666f\u5b58\u5728\u4e00\u5b9a\u5173\u8054\u3002`;
  }
  return `${subject}\u76ee\u524d\u66f4\u504f\u4e00\u822c\u6e38\u620f\u8d44\u8baf\u3002`;
}

function extractKeywordSignals(item: NewsItem, scores: RelevanceScoreResult): string[] {
  const content = normalizeText(item);
  const keywords = new Set<string>();
  for (const signal of [...aiSignals, ...gameSignals, ...crossSignals]) {
    if (signal.pattern.test(content)) {
      keywords.add(signal.label);
    }
  }
  if (scores.crossRelevanceScore >= 70) {
    keywords.add("AI x 游戏");
  }
  return [...keywords].slice(0, 8);
}

function countKeywordHits(content: string, signals: SignalDefinition[]): number {
  return signals.reduce((count, signal) => count + (signal.pattern.test(content) ? 1 : 0), 0);
}

function scoreNewsValue(item: NewsItem, scores: RelevanceScoreResult): number {
  const content = normalizeText(item);
  const valueHits = countKeywordHits(content, [
    { label: "发布", pattern: /发布|上线|推出|接入/ },
    { label: "融资", pattern: /融资|funding/i },
    { label: "合作", pattern: /合作|partnership/i },
    { label: "announce", pattern: /\bannounce|release|launch\b/i }
  ]);
  return clampScore(Math.round((scores.crossRelevanceScore * 0.55) + (item.sourceWeight * 0.2) + (valueHits * 6) + 20));
}

function buildArticleBody(title: string, content: string): string {
  const lead = title ? `${title}\u3002` : "";
  const detail = content.length > 220 ? `${content.slice(0, 220).trimEnd()}...` : content;
  return `${lead}${detail}`;
}

function buildFinalCommentary(item: NewsItem): string {
  return "AI工具已经摸到游戏研发和运营现场，这波不是概念秀而是工作流改造！";
}

function buildFinalSummary(item: NewsItem): string {
  const base = localizeMockFact(compactContent(item.summary || item.rawContent));
  const tagText = [...item.aiTags, ...item.gameTags].slice(0, 4).join("\u3001") || item.category || "AI x \u6e38\u620f";
  return [
    `1. ${base.length > 150 ? `${base.slice(0, 147).trimEnd()}...` : base}`,
    `2. \u8fd9\u6761\u52a8\u6001\u6765\u81ea${item.sourceName}\uff0c\u53d8\u5316\u91cd\u70b9\u96c6\u4e2d\u5728${tagText}\u76f8\u5173\u6d41\u7a0b\u3002`,
    "3. \u540e\u7eed\u53ef\u7ee7\u7eed\u89c2\u5bdf\u5b83\u4f1a\u5148\u843d\u5230\u7814\u53d1\u63d0\u6548\u3001\u5185\u5bb9\u751f\u4ea7\uff0c\u8fd8\u662f\u957f\u671f\u8fd0\u8425\u73af\u8282\u3002"
  ].join("\n");
}

function localizeMockFact(value: string): string {
  return value
    .replace(
      /A game studio released AI-assisted NPC tooling for live operations and narrative testing\./i,
      "\u4e00\u5bb6\u6e38\u620f\u5de5\u4f5c\u5ba4\u53d1\u5e03\u4e86\u7528\u4e8e\u5b9e\u65f6\u8fd0\u8425\u548c\u53d9\u4e8b\u6d4b\u8bd5\u7684 AI NPC \u5de5\u5177\u3002"
    )
    .replace(
      /A non-AI seasonal sale started for several catalog games\./i,
      "\u591a\u6b3e\u5e93\u5b58\u6e38\u620f\u5f00\u542f\u4e86\u4e00\u6b21\u4e0e AI \u65e0\u5173\u7684\u5b63\u8282\u6027\u4fc3\u9500\u3002"
    );
}

function deriveTitle(content: string): string {
  return compactContent(content).slice(0, 40);
}

function classifyCategory(scores: RelevanceScoreResult): string {
  if (scores.crossRelevanceScore >= 65) {
    return "AI x Game";
  }
  if (scores.aiRelevanceScore >= scores.gameRelevanceScore) {
    return "AI";
  }
  return "Game Industry";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export async function enrichWithProvider(
  provider: AIProvider,
  items: NewsItem[],
  options: ClassificationOptions
): Promise<NewsItem[]> {
  const enriched: NewsItem[] = [];

  for (const item of items) {
    const [classification, summary, keywords, article] = await Promise.all([
      provider.classifyAndFilter(item, options),
      provider.summarize(item),
      provider.extractKeywords(item),
      provider.generateArticleEntry(item)
    ]);
    const selected = classification.isTopicCandidate && item.duplicateOf === null;

    enriched.push({
      ...item,
      summary: summary.summary,
      keywords: keywords.keywords,
      category: article.category,
      score: classification.crossRelevanceScore,
      newsValueScore: classification.newsValueScore,
      selected,
      articleTitle: article.title,
      articleBody: article.body,
      introSummary: summary.introSummary,
      officialSources: article.officialSources,
      scriptSegments: (await provider.generateVoiceoverScript([{ ...item, articleTitle: article.title, summary: summary.summary, introSummary: summary.introSummary }])).segments,
      aiRelevanceScore: classification.aiRelevanceScore,
      gameRelevanceScore: classification.gameRelevanceScore,
      crossRelevanceScore: classification.crossRelevanceScore,
      aiTags: classification.aiTags,
      gameTags: classification.gameTags,
      isTopicCandidate: classification.isTopicCandidate,
      exclusionReason: classification.exclusionReasons.join("; ")
    });
  }

  return enriched;
}
