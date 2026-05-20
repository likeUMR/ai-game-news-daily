# 智游镜 AI 游戏新闻日报系统

这是为微信公众号 **智游镜** 搭建的 AI + 游戏行业内容生产流水线，用来自动采集、筛选、生成和发布日报、周报素材。项目会把 AI 模型、游戏行业、AIGC 游戏研发、发行运营和社区热点汇总成可直接用于公众号、知乎、展示页和视频脚本的内容包。

关注公众号 **智游镜**，获取每日 AI 游戏新闻速递和每周趋势复盘：

![智游镜公众号二维码](./智游镜.jpg)

## 项目目标

- 为 **智游镜** 公众号稳定产出「每日 AI 游戏新闻速递」和「每周 AI 游戏新闻复盘」。
- 自动完成新闻采集、去重、AI 相关性筛选、选题审计、文章生成、公众号 HTML 渲染和分发包整理。
- 保留 SQLite 数据库、审计 JSON、运行记录和输出文件，方便复查每条新闻为什么入选或被排除。
- 同时支持本地静态展示页、GitHub Pages 预览、知乎 Markdown、微信公众号 HTML 和视频制作素材。

## 工作流概览

```text
source registry
  -> collectors
  -> SQLite raw item store
  -> AI screening and enrichment
  -> dedupe and automated selection audit
  -> article/text rendering
  -> weekly aggregation
  -> TTS narration and frame rendering
  -> video composition
  -> distribution packages
```

主要模块：

- `src/config`：环境变量解析和新闻源注册表。
- `src/collectors`：RSS、网页、JSON API、手动 Markdown 和 mock 采集器。
- `src/db`：SQLite 持久化，保存原始新闻、处理结果、审计记录、运行记录和输出内容。
- `src/ai`：mock 与 OpenAI-compatible AI Provider。
- `src/pipeline`：日报流水线、周报流水线、筛选、去重、选题、文章生成和渲染编排。
- `src/render`：日报 Markdown、知乎 Markdown、微信公众号 HTML、周报 Markdown/HTML 渲染器。
- `src/video`：口播规划、TTS、视频帧渲染和视频合成。
- `src/distribution`：本地分发包导出。
- `src/cli`：命令行入口。

更详细的架构说明见 [docs/architecture.md](./docs/architecture.md)。

## 快速开始

项目要求 Node.js 20 或更高版本。

```bash
npm install
npm run build
npm test
```

复制环境变量模板并按需填写真实模型 Key：

```bash
cp .env.example .env
```

生成当日完整日报：

```bash
npm run run-daily
```

生成指定日期日报：

```bash
npm run run-daily -- --date 2026-05-20
```

生成周报。周报会读取过去 7 天内已经被日报采纳的内容，并输出周报 Markdown 与公众号 HTML：

```bash
npm run run-weekly -- --date 2026-05-20
```

使用 mock 模式做本地演示或确定性测试：

```bash
npm run run-daily -- --mock
```

## 常用命令

```bash
npm run init-db
npm run collect
npm run screen
npm run select
npm run generate-article
npm run render-text
npm run run-daily
npm run run-weekly
```

常用参数：

```bash
npm run run-daily -- --date 2026-05-20
npm run run-daily -- --limit 5
npm run run-daily -- --config .env.local
npm run run-weekly -- --date 2026-05-20 --limit 9
```

无人值守日报命令示例：

```bash
npm install && npm run build && npm test && npm run run-daily
```

## 新闻源策略

新闻源定义在 `src/config/sourceRegistry.ts`，启动时会自动校验。每个源包含：

- `id`、`name`、可选 `url`
- `source_group`：`ai_native`、`game_native`、`ai_x_game`、`official_community` 或 `manual`
- `source_type`：`ai_media`、`game_media`、`ai_game_media`、`official` 或 `community`
- `priority`：`high`、`medium` 或 `low`
- `source_weight`：1-100
- `collection_strategy`：`rss`、`rsshub`、`web_page`、`json_api`、`x_social`、`manual_markdown`、`official_site` 或 `community_submission`
- 采集频率建议和单源采集上限

真实流水线默认使用 RSS、JSON API、网页和手动 Markdown 采集器；`MOCK_MODE=true` 时使用确定性的 demo 数据。手动补充材料放在 `data/manual`。

源策略细节见 [docs/source-policy.md](./docs/source-policy.md)。

## AI 与媒体 Provider

AI Provider：

- `MODEL_PROVIDER=mock`：本地确定性 Provider，适合测试和演示。
- `MODEL_PROVIDER=openai`：OpenAI-compatible `/chat/completions` Provider，用于筛选和文章生成。
- `anthropic`、`google`、`local` 当前仅作为配置枚举保留，尚未实现具体 Provider。

TTS Provider：

- `TTS_PROVIDER=mock`：写入确定性的静音 WAV。
- 非 mock TTS 走 HTTP 适配器，需要 `TTS_HTTP_ENDPOINT`，可选 `TTS_HTTP_API_KEY` 和 `TTS_HTTP_VOICE`。
- `openai`、`edge`、`local` 当前会路由到通用 HTTP TTS 适配器。

视频合成：

- `VIDEO_COMPOSER_MODE=mock`：生成确定性的 mock `daily.mp4` JSON。
- `VIDEO_COMPOSER_MODE=ffmpeg` 或 auto 模式会在可用时调用 `ffmpeg`。
- `FFMPEG_PATH` 可覆盖 ffmpeg 可执行文件路径。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `MOCK_MODE` | `false` | 默认使用真实采集和真实 Provider。设为 `true` 时启用确定性 mock。 |
| `APP_ROOT` | 当前工作目录 | 解析数据和输出路径的项目根目录。 |
| `OUTPUT_DIR` | `output` | 生成内容输出目录。 |
| `DATA_DIR` | `data` | 运行数据和手动 Markdown 输入目录。 |
| `DATABASE_PATH` | `data/news-daily.sqlite` | SQLite 数据库路径。 |
| `COLLECTION_WINDOW_HOURS` | `24` | 采集时间窗口。 |
| `DEDUPE_WINDOW_HOURS` | `72` | 采集去重窗口。 |
| `MODEL_PROVIDER` | `openai` | 已实现 `mock` 和 `openai`。 |
| `OPENAI_COMPATIBLE_API_KEY` | 未设置 | OpenAI-compatible 服务 Key，`LLM_TOKEN` 也可作为别名。 |
| `OPENAI_API_KEY` | 未设置 | OpenAI 官方 API Key 回退项。 |
| `OPENAI_COMPATIBLE_BASE_URL` | 兼容服务默认值 | `/chat/completions` 基础地址，`LLM_BASE_URL` 也可作为别名。 |
| `OPENAI_COMPATIBLE_MODEL` | 兼容服务默认值 | 聊天模型名，`LLM_MODEL` 也可作为别名。 |
| `OPENAI_MODEL` | `gpt-4o-mini` | 使用 OpenAI 官方 Key 时的模型名。 |
| `TTS_PROVIDER` | `mock` | `mock` 或 HTTP-backed Provider 名称。 |
| `TTS_HTTP_ENDPOINT` | 未设置 | 非 mock TTS 必填。 |
| `TTS_HTTP_API_KEY` | 未设置 | HTTP TTS Bearer Token。 |
| `TTS_HTTP_VOICE` | 未设置 | HTTP TTS 声音参数。 |
| `MIN_AI_RELEVANCE_SCORE` | `50` | AI 相关性阈值。 |
| `MIN_GAME_RELEVANCE_SCORE` | `50` | 游戏相关性阈值。 |
| `MIN_NEWS_VALUE_SCORE` | `55` | 新闻价值阈值。 |
| `MIN_CROSS_RELEVANCE_SCORE` | `60` | AI x 游戏交叉相关性阈值。 |
| `DAILY_ITEM_COUNT` | `5` | 日报入选条数。 |
| `DAILY_CATEGORY_COUNTS` | `AI x Game=5` | 日报分类配额。 |
| `LOW_TRUST_SOURCE_WEIGHT` | `40` | 低可信源权重分界。 |
| `LOW_TRUST_HIGH_SCORE` | `85` | 低可信源入选所需高分。 |
| `SELECTION_FRESHNESS_HOURS` | `72` | 入选内容最大新鲜度。 |
| `VIDEO_FRAME_WIDTH` / `VIDEO_FRAME_HEIGHT` | `1920` / `1080` | 视频帧尺寸。 |
| `MAX_ITEMS_PER_SOURCE` | `50` | 单源采集上限。 |
| `MAX_ITEMS_TOTAL` | `500` | 总采集和筛选上限。 |

## 输出产物

以运行日期 `YYYY-MM-DD` 为例，产物位于 `output/YYYY-MM-DD/`：

- `daily.md`：日报 Markdown。
- `daily-report.md`：兼容旧路径的日报 Markdown。
- `zhihu.md`：知乎 Markdown 版本。
- `wechat.html`：微信公众号 HTML 版本，可作为「智游镜」日报发布底稿。
- `weekly.md`：周报 Markdown。
- `weekly.html`：周报公众号 HTML。
- `audit/editorial-selection-audit.json`：自动选题与校验审计。
- `audio/*.wav`：TTS 音频片段。
- `subtitles.srt`：字幕文件。
- `frames/html/` 和 `frames/png/`：视频画面渲染产物。
- `video-plan.json`：口播、画面、字幕和合成计划。
- `daily.mp4`：ffmpeg 视频或 mock JSON 产物。
- `video-composition-audit.json`：视频合成审计。
- `distribution/manifest.json`：分发包清单。
- `distribution/<platform>/metadata.json`：`bilibili`、`youtube`、`wechat`、`zhihu`、`xiaohongshu`、`douyin` 等平台元数据。
- `pipeline-run.json`：完整运行记录，包含阶段、错误、入选条目和产物路径。

SQLite 数据库默认写入 `data/news-daily.sqlite`。

分发包语义和后续上传钩子见 [docs/publishing.md](./docs/publishing.md)。

## 展示页与流程图

项目包含一个本地内容展示页和一个交互式系统流程图，便于检查日报、周报和流水线设计。

- `index.html`：展示入口，使用 `display/js/` 和 `display/css/style.css`，支持切换日报和周报，并检查最近 7 天产物状态。
- `project-flow.html`：完整项目流程图，展示日报/周报流水线、新闻源权重和自动筛选策略。

建议使用本地静态服务器预览：

```bash
npx serve .
```

直接用 `file://` 打开时，浏览器可能因 ES Modules 触发 CORS 限制。

## GitHub Pages 发布

项目可以直接发布为 GitHub Pages 展示站：

1. 将代码和需要公开的 `output/` 静态产物推送到 GitHub 仓库。
2. 进入仓库 **Settings** -> **Pages**。
3. 在 **Build and deployment** 中选择 **Deploy from a branch**。
4. 选择主分支和根目录 `/`。
5. 稍等片刻后访问 `https://<your-username>.github.io/<your-repo-name>/`。

## 定时运行

项目目前提供文档级调度示例，不会自动注册系统任务。

```bash
npm run schedule:daily:example
```

Cron 示例：

```cron
0 8 * * * cd /path/to/ai-game-news-daily && npm run run-daily
```

Windows Task Scheduler action：

```text
Program/script: powershell
Arguments: -NoProfile -ExecutionPolicy Bypass -Command "Set-Location 'C:\path\to\ai-game-news-daily'; npm run run-daily"
```

## 故障排查

- `MODEL_PROVIDER=openai requires OPENAI_COMPATIBLE_API_KEY or OPENAI_API_KEY.`：配置模型 Key，或临时使用 `MODEL_PROVIDER=mock`。
- `TTS_PROVIDER=... requires TTS_HTTP_ENDPOINT`：非 mock TTS 需要配置 HTTP TTS Endpoint。
- 没有选出新闻：降低阈值，检查新闻源权重，查看 `audit/editorial-selection-audit.json`，并确认新闻时间在 `SELECTION_FRESHNESS_HOURS` 内。
- 重复内容缺失：查看审计文件里的 `duplicate` 条目。系统会跳过或合并精确重复和近似重复新闻。
- `daily.mp4` 不是可播放视频：当前启用了 mock 合成。安装 `ffmpeg` 并使用 `VIDEO_COMPOSER_MODE=ffmpeg`。
- 真实 Provider 冒烟测试：配置 OpenAI-compatible 环境变量后运行 `npm run test:llm`。

## 验证

提交前建议运行：

```bash
npm run build
npm test
```
