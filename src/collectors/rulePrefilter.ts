import type { RawCollectedItem } from "./types.js";

export interface RulePrefilterResult {
  item: RawCollectedItem;
  score: number;
  matchedSignals: string[];
}

const lowTrustSourceIds = new Set(["3dm", "gamersky"]);

const aiSignals = [
  /(?:^|[^a-z])ai(?:[^a-z]|$)/i,
  /aigc|llm|agent/i,
  /人工智能|大模型|智能体|生成式|机器学习|神经网络|ai聊天|聊天ai/i
];

const gameSignals = [
  /游戏|手游|端游|主机|玩家|电竞|steam|xbox|playstation|ps5|switch|任天堂|索尼|微软|腾讯|网易|nvidia|r星|育碧|米哈游|工作室|开发商|发行商/i
];

const industrySignals = [
  /引擎|开发者|研发|开发|发行|上线|融资|财报|营收|投资|收购|裁员|监管|审核|商业化|反作弊|工具|技术|测试|运营|合作|授权|并购/i,
  /engine|developer|studio|publishing|funding|partnership|revenue|earnings|acquisition|layoff|regulation/i
];

const negativeSignals = [
  /美女|写真|主播|八卦|恋情|囧图|火辣|擦边|福利|小姐姐|颜值|cos|cosplay/i,
  /史低|打折|促销|免费领|特惠|折扣|秒杀/i,
  /手机|汽车|电动车|相机|耳机|显卡|主板|cpu|处理器|笔记本|内存|dram|硬盘|ssd/i,
  /电影|电视剧|动画|漫画|票房|明星|演员/i
];

export function applyRulePrefilter(sourceId: string, items: RawCollectedItem[], limit: number): RawCollectedItem[] {
  if (!lowTrustSourceIds.has(sourceId)) {
    return items.slice(0, limit);
  }

  return scoreRulePrefilterItems(items)
    .filter((result) => result.score >= 8)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return Date.parse(right.item.published_at) - Date.parse(left.item.published_at);
    })
    .slice(0, limit)
    .map(({ item, score, matchedSignals }) => ({
      ...item,
      metadata: {
        ...item.metadata,
        rule_prefilter_score: score,
        rule_prefilter_signals: matchedSignals
      }
    }));
}

export function scoreRulePrefilterItems(items: RawCollectedItem[]): RulePrefilterResult[] {
  return items.map((item) => {
    const content = `${item.title} ${item.excerpt}`.toLowerCase();
    const matchedSignals: string[] = [];
    let score = 0;

    if (matchesAny(content, aiSignals)) {
      score += 14;
      matchedSignals.push("ai");
    }
    if (matchesAny(content, gameSignals)) {
      score += 5;
      matchedSignals.push("game");
    }
    if (matchesAny(content, industrySignals)) {
      score += 8;
      matchedSignals.push("industry");
    }
    if (matchesAny(content, negativeSignals)) {
      score -= 12;
      matchedSignals.push("negative");
    }
    if (!matchesAny(content, gameSignals)) {
      score -= 15;
      matchedSignals.push("off-topic-risk");
    }

    return { item, score, matchedSignals };
  });
}

function matchesAny(content: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(content));
}
