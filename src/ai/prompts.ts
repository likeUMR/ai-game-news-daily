export type PromptName =
  | "newsValue"
  | "aiRelevance"
  | "gameRelevance"
  | "crossRelevance"
  | "aiTags"
  | "gameTags"
  | "exclusionReasons"
  | "articleGeneration"
  | "groupedArticleGeneration"
  | "voiceoverScriptGeneration";

const groupedArticleExamples = [
  "Follow the style of these examples when writing articleBody and introSummary.",
  "",
  "Example 1",
  "Title: 新一代实时通用游戏AI Pixel2Play发布，开源8300小时数据",
  "articleBody:",
  "1. Open-P2P团队发布Pixel2Play，以游戏画面+文本指令为输入输出操作信号，消费级显卡可实现超20Hz实时交互。",
  "2. 训练覆盖超40款游戏、8300+小时数据，支持零样本玩Roblox/Steam游戏，开源全部代码与数据集。",
  "3. 模型采用轻量级Transformer+action-decoder，参数量150M-1.2B，最大模型推理速度40Hz，指令遵循任务通过率从20%提升至80%。",
  "introSummary: 开源+跨游戏泛化，Pixel2Play这是要把游戏AI门槛打下来！",
  "",
  "Example 2",
  "Title: AI以92%胜率登顶《英雄联盟》韩服，或为xAI Grok-5实战测试",
  "articleBody:",
  "1. 2026年1月，ID“택배기사”账号以51小时56局52胜4负、92%胜率登顶韩服，表现远超人类职业选手常见的50%-70%区间。",
  "2. 行为模式暴露AI特质：每日高强度对战14.5小时、操作精度几乎无波动，外界推测为马斯克xAI团队Grok-5的实战测试。",
  "3. Grok-5通过视觉驱动决策、强化学习自我进化及受限环境效率优化，实现“看屏-分析-操作”全流程模拟人类。",
  "introSummary: AI打LOL比人还肝，这波是机器碾压人类操作上限！",
  "",
  "Example 3",
  "Title: NVIDIA ACE自主意识游戏角色重新定义游戏AI，多游戏落地",
  "articleBody:",
  "1. NVIDIA在CES 2025推出ACE自主意识游戏角色，借助生成式AI让角色具备感知、计划、行动能力，并支持多种游戏类型。",
  "2. 技术链路覆盖感知、认知、行动、记忆四层：音频/视觉/游戏状态模型输入，小语言模型推理，再到行动选择、TTS和RAG记忆。",
  "3. 落地案例包括《PUBG》AI队友、《永劫无间》手游PC版AI队友、《inZOI》Smart Zoi和《传奇5》AI Boss等。",
  "introSummary: 从队友到Boss都能“活”过来，ACE这波让游戏AI有了“灵魂”！",
  "",
  "Example 4",
  "Title: PixVerse R1让AI视频像打游戏一样可控，实时互动成新范式",
  "articleBody:",
  "1. PixVerse R1把视频生成变成实时互动系统，用户输入指令后画面可即时变化，核心特征是实时生成、无限延续和即时响应。",
  "2. 技术侧由Omni统一多模态处理、Memory记忆模块维持连贯性、IRE压缩生成步骤提速，目标是实现1080P实时生成。",
  "3. 应用场景覆盖AI原生游戏、互动电影、教育培训和VR/XR，内容形态从“静态作品”转向“动态世界”。",
  "introSummary: 视频能实时对话，这哪是看片，分明是在“玩”世界！",
  "",
  "Example 5",
  "Title: 马斯克预言AI几分钟生成《GTA6》，玩家与大佬激辩",
  "articleBody:",
  "1. 马斯克称生成式AI未来可让用户在几分钟内造出《GTA6》，并由此引发与OpenAI技术路线及Epic CEO等观点的交锋。",
  "2. 玩家质疑主要集中在现实差距：一款《GTA6》级3A产品耗时8年、投入约10亿美元，AI在3D空间一致性、物理引擎和实时算力上仍明显不足。",
  "3. 行业内更现实的共识是，AI短期仍以辅助工具为主，可帮助中小团队把开发周期从18个月压缩到6个月，但难替代3A内容的人文创意。",
  "introSummary: 马斯克又放卫星，但AI造3A确实还差得远，先让子弹飞会儿～"
].join("\n");

export const promptTemplates: Record<PromptName, string> = {
  newsValue: [
    "Score the news value of this item from 0 to 100.",
    "Prefer fresh, specific, source-backed developments over evergreen commentary.",
    "Return JSON: {\"newsValueScore\": number}.",
    "Title: {{title}}",
    "Source: {{sourceName}}",
    "Content: {{content}}"
  ].join("\n"),
  aiRelevance: [
    "Score how relevant this item is to artificial intelligence from 0 to 100.",
    "Return JSON: {\"aiRelevanceScore\": number}.",
    "Content: {{content}}"
  ].join("\n"),
  gameRelevance: [
    "Score how relevant this item is to games, game studios, game production, publishing, or live operations from 0 to 100.",
    "Return JSON: {\"gameRelevanceScore\": number}.",
    "Content: {{content}}"
  ].join("\n"),
  crossRelevance: [
    "Score the overlap between AI and games from 0 to 100.",
    "High scores require both concrete AI substance and concrete game industry impact.",
    "Return JSON: {\"crossRelevanceScore\": number}.",
    "Content: {{content}}"
  ].join("\n"),
  aiTags: [
    "Extract compact AI tags for this item.",
    "Use lower-case tags such as tooling, model, agent, workflow, safety, multimodal, infra.",
    "Return JSON: {\"aiTags\": string[]}.",
    "Content: {{content}}"
  ].join("\n"),
  gameTags: [
    "Extract compact game industry tags for this item.",
    "Use lower-case tags such as development, npc, qa, art, live-ops, publishing, engine.",
    "Return JSON: {\"gameTags\": string[]}.",
    "Content: {{content}}"
  ].join("\n"),
  exclusionReasons: [
    "Decide why this item should be excluded from an AI + game daily briefing.",
    "Return JSON: {\"exclusionReasons\": string[]}. Empty means keep it.",
    "Scores: AI {{aiRelevanceScore}}, game {{gameRelevanceScore}}, cross {{crossRelevanceScore}}.",
    "Content: {{content}}"
  ].join("\n"),
  articleGeneration: [
    "Write a concise AI + game daily news entry from the item.",
    "Return JSON: {\"title\": string, \"body\": string, \"category\": string, \"officialSources\": string[]}.",
    "Source URL: {{sourceUrl}}",
    "Summary: {{summary}}",
    "Tags: {{tags}}",
    "Content: {{content}}"
  ].join("\n"),
  groupedArticleGeneration: [
    "Write final AI + game daily report entries from the grouped selected items.",
    "Use only the supplied item summaries, raw metadata, categories, and source links.",
    groupedArticleExamples,
    "Now write entries in the same style.",
    "Return JSON: {\"entries\": [{\"id\": string, \"articleTitle\": string, \"articleBody\": string, \"introSummary\": string, \"sourceLinks\": string[]}]}.",
    "For each entry, articleBody should be 3 numbered factual points and introSummary must be a Chinese punchy点评句 in the same style as the examples.",
    "Style target: write like 小编评论, not a corporate AI report. Keep introSummary short, oral, sharp, and concrete; phrases like 这波, 门槛打下来, 碾压上限, 有了灵魂, 分明是在玩世界 are good reference patterns.",
    "Avoid generic AI/corporate wording in titles and introSummary, including 赋能、重塑、底座、生态、范式、提效、效率、工业化、闭环、落地信号.",
    "introSummary must not repeat, translate, truncate, or paraphrase the title; it should add a sharp editorial take based on the facts.",
    "If you cannot produce a high-quality Chinese introSummary from the supplied context, do not return a low-quality placeholder.",
    "Do not invent facts beyond the supplied context.",
    "Use strictFacts as the hard factual boundary for each item.",
    "Respect missingDetails: do not fill absent details just to make the entry sound complete.",
    "When the supplied context is sparse, keep the entry sparse too: say what is currently confirmed instead of adding capabilities, metrics, dates, names, mechanisms, or effects not present in the context.",
    "For sparse items, use this articleBody shape: point 1 starts with 当前可确认; point 2 starts with 原始材料未提供 and lists the missing detail boundaries; point 3 starts with 观察重点 and only references supplied tags or category.",
    "Every returned entry must preserve at least one supplied source link for that item.",
    "Grouped context: {{groupedContext}}"
  ].join("\n\n"),
  voiceoverScriptGeneration: [
    "Create a spoken voiceover script for an AI + game daily news video.",
    "Return JSON: {\"segments\": string[]}.",
    "Keep each segment natural and short.",
    "Article entries: {{entries}}"
  ].join("\n")
};

export function renderPrompt(template: string, variables: Record<string, string | number | boolean>): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === undefined) {
      throw new Error(`Missing prompt variable: ${key}`);
    }
    return String(value);
  });
}

export function getPrompt(name: PromptName, variables: Record<string, string | number | boolean>): string {
  return renderPrompt(promptTemplates[name], variables);
}
