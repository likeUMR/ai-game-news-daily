import type { NewsItem } from "../pipeline/types.js";
import { renderDailyMarkdown } from "../render/markdownRenderer.js";
import { getPrompt } from "./prompts.js";
import {
  articleEntrySchema,
  classificationSchema,
  groupedArticleEntriesSchema,
  keywordsSchema,
  markdownSchema,
  parseAiJsonResponse,
  relevanceScoreSchema,
  summarySchema,
  voiceoverScriptSchema,
  type ArticleEntryResult,
  type ClassificationResult,
  type GroupedArticleEntriesResult,
  type KeywordsResult,
  type MarkdownResult,
  type RelevanceScoreResult,
  type SummaryResult,
  type VoiceoverScriptResult
} from "./schemas.js";
import type { AIProvider, ArticleGenerationContextGroup, ClassificationOptions } from "./types.js";

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

const defaultOpenAiBaseUrl = "https://api.openai.com/v1";
const defaultOpenAiModel = "gpt-4o-mini";
const defaultRelayBaseUrl = "https://api.openai.com/v1";
const defaultRelayModel = "gpt-4o-mini";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: ChatMessageContent;
    };
  }>;
}

type ChatMessageContent = string | Array<{ type?: string; text?: string }>;

interface CompletionAttempt {
  ok: boolean;
  status: number;
  statusText: string;
  bodyText: string;
}

export class OpenAICompatibleProvider implements AIProvider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: OpenAICompatibleProviderOptions) {
    this.baseUrl = options.baseUrl ?? defaultOpenAiBaseUrl;
    this.model = options.model ?? defaultOpenAiModel;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): OpenAICompatibleProvider | null {
    const usesCompatibleRelay = Boolean(env.OPENAI_COMPATIBLE_API_KEY ?? env.LLM_TOKEN);
    const apiKey = env.OPENAI_COMPATIBLE_API_KEY ?? env.LLM_TOKEN ?? env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }

    return new OpenAICompatibleProvider({
      apiKey,
      baseUrl: env.OPENAI_COMPATIBLE_BASE_URL ?? env.LLM_BASE_URL ?? (usesCompatibleRelay ? defaultRelayBaseUrl : undefined),
      model: env.OPENAI_COMPATIBLE_MODEL ?? env.LLM_MODEL ?? env.OPENAI_MODEL ?? (usesCompatibleRelay ? defaultRelayModel : undefined)
    });
  }

  async classifyAndFilter(item: NewsItem, options: ClassificationOptions): Promise<ClassificationResult> {
    const prompt = [
      getPrompt("newsValue", itemVariables(item)),
      getPrompt("aiRelevance", itemVariables(item)),
      getPrompt("gameRelevance", itemVariables(item)),
      getPrompt("crossRelevance", itemVariables(item)),
      getPrompt("aiTags", itemVariables(item)),
      getPrompt("gameTags", itemVariables(item)),
      "Return one JSON object matching this schema:",
      "{\"newsValueScore\": number, \"aiRelevanceScore\": number, \"gameRelevanceScore\": number, \"crossRelevanceScore\": number, \"isTopicCandidate\": boolean, \"exclusionReasons\": string[], \"aiTags\": string[], \"gameTags\": string[]}",
      `Minimum cross relevance score: ${options.minCrossRelevanceScore}`
    ].join("\n\n");
    return parseAiJsonResponse(await this.completeJson(prompt), classificationSchema);
  }

  async summarize(item: NewsItem): Promise<SummaryResult> {
    return parseAiJsonResponse(
      await this.completeJson(`Summarize this item. Return JSON: {"summary": string, "introSummary": string}.\n${item.rawContent}`),
      summarySchema
    );
  }

  async extractKeywords(item: NewsItem): Promise<KeywordsResult> {
    return parseAiJsonResponse(
      await this.completeJson(`Extract up to 20 keywords. Return JSON: {"keywords": string[]}.\n${item.rawContent}`),
      keywordsSchema
    );
  }

  async scoreRelevance(item: NewsItem): Promise<RelevanceScoreResult> {
    const prompt = [
      getPrompt("aiRelevance", itemVariables(item)),
      getPrompt("gameRelevance", itemVariables(item)),
      getPrompt("crossRelevance", itemVariables(item)),
      "Return JSON: {\"aiRelevanceScore\": number, \"gameRelevanceScore\": number, \"crossRelevanceScore\": number}."
    ].join("\n\n");
    return parseAiJsonResponse(await this.completeJson(prompt), relevanceScoreSchema);
  }

  async generateArticleEntry(item: NewsItem): Promise<ArticleEntryResult> {
    const article = parseAiJsonResponse(
      await this.completeJson(getPrompt("articleGeneration", {
        ...itemVariables(item),
        sourceUrl: item.sourceUrl,
        summary: item.summary || item.rawContent,
        tags: [...item.aiTags, ...item.gameTags, ...item.keywords].join(", ")
      })),
      articleEntrySchema
    );

    return {
      ...article,
      officialSources: article.officialSources ?? []
    };
  }

  async generateArticleEntries(groups: ArticleGenerationContextGroup[]): Promise<GroupedArticleEntriesResult> {
    const groupedContext = JSON.stringify(groups.map((group) => ({
      category: group.category,
      items: group.items.map((item) => ({
        id: item.id,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        sourceLinks: [...new Set([item.sourceUrl, ...item.officialSources].filter(Boolean))],
        publishedAt: item.publishedAt,
        summary: item.summary,
        introSummary: item.introSummary,
        rawContent: item.rawContent,
        tags: [...item.aiTags, ...item.gameTags, ...item.keywords],
        strictFacts: [item.summary, item.rawContent].filter(Boolean),
        missingDetails: "Do not add vendor names, product names, dates, metrics, technical mechanisms, rollout scope, effectiveness claims, or downstream impact unless they are explicitly present in strictFacts."
      }))
    })));

    return parseAiJsonResponse(
      await this.completeJson(getPrompt("groupedArticleGeneration", { groupedContext })),
      groupedArticleEntriesSchema
    );
  }

  async formatMarkdown(items: NewsItem[], generatedAt: string): Promise<MarkdownResult> {
    const rendered = renderDailyMarkdown(items, generatedAt);
    return parseAiJsonResponse(
      await this.completeJson(`Format this markdown. Return JSON: {"markdown": string}.\n${rendered}`),
      markdownSchema
    );
  }

  async generateVoiceoverScript(items: NewsItem[]): Promise<VoiceoverScriptResult> {
    const entries = JSON.stringify(items.map((item) => ({
      title: item.articleTitle,
      summary: item.introSummary || item.summary,
      body: item.articleBody
    })));
    return parseAiJsonResponse(
      await this.completeJson(getPrompt("voiceoverScriptGeneration", { entries })),
      voiceoverScriptSchema
    );
  }

  private async completeJson(prompt: string): Promise<string> {
    let response = await this.requestCompletion(prompt, true);

    if (!response.ok && shouldRetryWithoutResponseFormat(response)) {
      response = await this.requestCompletion(prompt, false);
    }

    if (!response.ok) {
      throw new Error(`OpenAI-compatible provider request failed: ${response.status} ${response.statusText}`);
    }

    let data: ChatCompletionResponse;
    try {
      data = JSON.parse(response.bodyText) as ChatCompletionResponse;
    } catch (error) {
      throw new Error("OpenAI-compatible provider returned malformed JSON.", { cause: error });
    }

    const content = normalizeMessageContent(data.choices?.[0]?.message?.content);
    if (!content) {
      throw new Error("OpenAI-compatible provider returned an empty response.");
    }

    return content;
  }

  private async requestCompletion(prompt: string, includeResponseFormat: boolean): Promise<CompletionAttempt> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        {
          role: "system",
          content: "You are a strict JSON API for an AI + game news daily pipeline. Return JSON only."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    };

    if (includeResponseFormat) {
      body.response_format = { type: "json_object" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        bodyText: await response.text()
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeMessageContent(content: ChatMessageContent | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  }

  return "";
}

function shouldRetryWithoutResponseFormat(response: CompletionAttempt): boolean {
  if (![400, 422].includes(response.status)) {
    return false;
  }

  return /response_format|json_object|unsupported|not supported/i.test(response.bodyText);
}

function itemVariables(item: NewsItem): Record<string, string | number | boolean> {
  return {
    title: item.articleTitle || item.rawContent.slice(0, 80),
    sourceName: item.sourceName,
    content: item.rawContent
  };
}
