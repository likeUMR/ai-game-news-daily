import type { NewsItem } from "../pipeline/types.js";

export async function collectMockNews(now = new Date()): Promise<NewsItem[]> {
  const collectedAt = now.toISOString();

  return [
    createItem({
      id: "mock-pixel2play-release",
      sourceName: "智游镜 Testground",
      sourceType: "ai_game_media",
      sourceWeight: 90,
      sourceUrl: "https://example.com/pixel2play-release",
      rawContent: [
        "Open-P2P团队发布新一代实时通用游戏AI Pixel2Play，以游戏画面和文本指令作为输入，输出可执行的操作信号，消费级显卡可实现超过20Hz实时交互。",
        "训练数据覆盖40多款游戏、8300小时以上游玩记录，支持零样本操作Roblox和Steam游戏，并开源全部代码与数据集。",
        "模型采用轻量级Transformer与action-decoder架构，参数量覆盖150M到1.2B，最大模型推理速度约40Hz，指令遵循任务通过率从20%提升到80%。"
      ].join("\n"),
      publishedAt: collectedAt
    }),
    createItem({
      id: "mock-sparse-npc-tooling",
      sourceName: "Sparse Testground",
      sourceType: "ai_game_media",
      sourceWeight: 90,
      sourceUrl: "https://example.com/sparse-npc-tooling",
      rawContent: "A game studio released AI-assisted NPC tooling for live operations and narrative testing.",
      publishedAt: collectedAt
    }),
    createItem({
      id: "mock-general-game-sale",
      sourceName: "General Game Wire",
      sourceType: "game_media",
      sourceWeight: 35,
      sourceUrl: "https://example.com/game-sale",
      rawContent: "A non-AI seasonal sale started for several catalog games.",
      publishedAt: collectedAt
    })
  ];
}

function createItem(input: Pick<NewsItem, "id" | "sourceName" | "sourceType" | "sourceWeight" | "sourceUrl" | "rawContent" | "publishedAt">): NewsItem {
  return {
    ...input,
    collectedAt: input.publishedAt,
    summary: "",
    keywords: [],
    category: "",
    score: 0,
    newsValueScore: 0,
    duplicateOf: null,
    selected: false,
    isMock: true,
    officialSources: [],
    articleTitle: "",
    articleBody: "",
    introSummary: "",
    assets: [],
    scriptSegments: [],
    ttsSegments: [],
    timeline: [],
    subtitleSrt: "",
    aiRelevanceScore: 0,
    gameRelevanceScore: 0,
    crossRelevanceScore: 0,
    aiTags: [],
    gameTags: [],
    isTopicCandidate: false,
    exclusionReason: ""
  };
}
