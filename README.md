# AI + Game News Daily

Autonomous Node.js + TypeScript pipeline for producing an AI + game industry daily. This implementation follows that workflow shape while replacing the brief's human review checkpoints with deterministic automated verification and audit artifacts.

## Architecture Overview

The system is organized as a daily production pipeline:

```text
source registry
  -> collectors
  -> SQLite raw item store
  -> AI screening and enrichment
  -> dedupe and automated selection audit
  -> article/text rendering
  -> TTS narration and frame rendering
  -> video composition
  -> distribution packages
```

Primary modules:

- `src/config`: environment parsing and source registry.
- `src/collectors`: demo, RSS, web page, and manual Markdown collectors.
- `src/db`: SQLite persistence for sources, raw items, processed items, runs, audits, and outputs.
- `src/ai`: mock and OpenAI-compatible AI providers.
- `src/pipeline`: screening, dedupe, selection, article generation, rendering orchestration, and full daily run.
- `src/render`: Markdown, Zhihu Markdown, and WeChat HTML renderers.
- `src/video`: narration planning, TTS, frame rendering, and video composition.
- `src/distribution`: local platform package export.
- `src/cli`: command entrypoint.

More detail: [docs/architecture.md](./docs/architecture.md).

## Data Flow

`npm run run-daily -- --mock` runs the complete no-human-intervention path. In mock mode it collects deterministic demo items, enriches them with deterministic mock AI, deduplicates, selects verified candidates, renders text outputs, creates mock TTS audio, renders frame HTML/PNG placeholders, writes a mock video artifact, and prepares platform packages.

Discrete commands also exist for staged operation:

```bash
npm run init-db
npm run collect
npm run screen
npm run generate-article
npm run render-text
npm run run-daily -- --mock
```

Useful options:

```bash
npm run run-daily -- --mock --date 2026-05-19
npm run run-daily -- --mock --limit 3
npm run run-daily -- --config .env
```

Complete unattended command:

```bash
npm install && npm run build && npm test && npm run run-daily -- --mock --date 2026-05-19
```

## Source Registry

Sources are defined in `src/config/sourceRegistry.ts` and validated at startup. Each source has:

- `id`, `name`, optional `url`
- `source_group`: `ai_native`, `game_native`, `ai_x_game`, `official_community`, or `manual`
- `source_type`: `ai_media`, `game_media`, `ai_game_media`, `official`, or `community`
- `priority`: `high`, `medium`, or `low`
- `source_weight`: 1-100
- `collection_strategy`: `rss`, `rsshub`, `web_page`, `x_social`, `manual_markdown`, `official_site`, or `community_submission`
- collection frequency and per-source item caps

Current mock pipeline execution uses `collectMockNews`/demo data for full-run determinism. The `collect`/`ingest` command uses `DemoCollector` and `MarkdownCollector` in mock mode, and RSS, web page, and manual Markdown collectors when `MOCK_MODE=false`. Manual Markdown files are read from `data/manual`.

Policy details: [docs/source-policy.md](./docs/source-policy.md).

## Providers

AI providers:

- `MODEL_PROVIDER=mock`: deterministic local provider for tests and unattended local runs.
- `MODEL_PROVIDER=openai`: OpenAI-compatible `/chat/completions` provider used by screening/article commands when credentials are configured.
- `anthropic`, `google`, and `local` are accepted config values but do not have implementations yet.

TTS providers:

- `TTS_PROVIDER=mock`: writes deterministic silent WAV files.
- Any non-mock TTS provider uses the HTTP adapter and requires `TTS_HTTP_ENDPOINT`; optional `TTS_HTTP_API_KEY` and `TTS_HTTP_VOICE` are passed through.
- `openai`, `edge`, and `local` are accepted names, but currently route through the generic HTTP TTS adapter.

Video composition:

- `VIDEO_COMPOSER_MODE=mock`: writes a deterministic JSON mock at `daily.mp4`.
- `VIDEO_COMPOSER_MODE=ffmpeg` or auto mode uses `ffmpeg` when available.
- Optional `FFMPEG_PATH` overrides the executable.

## Environment Variables

Copy [.env.example](./.env.example) to `.env` for local overrides.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOCK_MODE` | `true` | Enables deterministic local behavior. The full `run-daily` pipeline currently requires `true`. |
| `APP_ROOT` | current working directory | Root used to resolve data/output paths. |
| `OUTPUT_DIR` | `output` | Generated artifacts. |
| `DATA_DIR` | `data` | Runtime data and manual Markdown intake. |
| `DATABASE_PATH` | `data/news-daily.sqlite` | SQLite database path. |
| `COLLECTION_WINDOW_HOURS` | `24` | Intended collection recency window. |
| `DEDUPE_WINDOW_HOURS` | `72` | Recent-item dedupe window for collection. |
| `MODEL_PROVIDER` | `mock` | `mock` or `openai` for implemented AI providers. |
| `OPENAI_COMPATIBLE_API_KEY` | unset | API key for OpenAI-compatible relay. |
| `OPENAI_API_KEY` | unset | Fallback key for OpenAI default API. |
| `OPENAI_COMPATIBLE_BASE_URL` | relay default when compatible key is used | Base URL for `/chat/completions`. |
| `OPENAI_COMPATIBLE_MODEL` | relay default when compatible key is used | Chat model name. |
| `OPENAI_MODEL` | `gpt-4o-mini` fallback | OpenAI model when `OPENAI_API_KEY` is used. |
| `TTS_PROVIDER` | `mock` | `mock` or HTTP-backed provider name. |
| `TTS_HTTP_ENDPOINT` | unset | Required for non-mock TTS. |
| `TTS_HTTP_API_KEY` | unset | Optional HTTP TTS bearer token. |
| `TTS_HTTP_VOICE` | unset | Optional HTTP TTS voice. |
| `MIN_AI_RELEVANCE_SCORE` | `50` | Configured AI relevance threshold. |
| `MIN_GAME_RELEVANCE_SCORE` | `50` | Configured game relevance threshold. |
| `MIN_NEWS_VALUE_SCORE` | `55` | Minimum effective news value for screening. |
| `MIN_CROSS_RELEVANCE_SCORE` | `60` | Minimum effective AI x game relevance for screening and selection. |
| `DAILY_ITEM_COUNT` | `5` | Number of selected daily items. |
| `DAILY_CATEGORY_COUNTS` | `AI x Game=5` | Optional category quota map. |
| `LOW_TRUST_SOURCE_WEIGHT` | `40` | Sources below this require a higher score. |
| `LOW_TRUST_HIGH_SCORE` | `85` | Required score for low-trust sources. |
| `SELECTION_FRESHNESS_HOURS` | `72` | Maximum age for selected items. |
| `VIDEO_FRAME_WIDTH` / `VIDEO_FRAME_HEIGHT` | `1920` / `1080` | Rendered frame size. |
| `MAX_ITEMS_PER_SOURCE` | `50` | Collector cap per source. |
| `MAX_ITEMS_TOTAL` | `500` | Total collection/screening cap. |

## Output Artifacts

For a run date `YYYY-MM-DD`, expected outputs are under `output/YYYY-MM-DD/`:

- `daily-report.md`: legacy daily Markdown path.
- `daily.md`: daily Markdown.
- `zhihu.md`: Zhihu Markdown adaptation.
- `wechat.html`: WeChat HTML adaptation.
- `audit/editorial-selection-audit.json`: automated selection and verification audit.
- `audio/*.wav`: TTS audio segments.
- `subtitles.srt`: SRT subtitles.
- `frames/html/` and `frames/png/`: rendered frame artifacts.
- `video-plan.json`: narration, frame, subtitle, and composition plan.
- `daily.mp4`: ffmpeg video or mock JSON artifact depending on composer mode.
- `video-composition-audit.json`: composition audit.
- `distribution/manifest.json`: package manifest.
- `distribution/<platform>/metadata.json`: package metadata for `bilibili`, `youtube`, `wechat`, `zhihu`, `xiaohongshu`, and `douyin`.
- `pipeline-run.json`: full run record with stages, errors, selected items, and artifact paths.

The SQLite database is written to `data/news-daily.sqlite` by default.

Distribution package semantics and future upload hooks: [docs/publishing.md](./docs/publishing.md).

## Display Page & Flowchart

The system includes a modern, responsive **Report Display Page** and an interactive **System Flowchart** to easily review generated daily and weekly artifacts.

### Components

- **`index.html`**: The main landing page of the display app. Built using modular ES6 JavaScript (`display/js/`) and pure CSS (`display/css/style.css`).
  - Supports switching between Daily (WeChat HTML) and Weekly reports.
  - Automatically queries and displays reports from the last 7 days.
  - Integrates asynchronous backend state probing (lights up a green indicator if a report is generated for a given day, or red/gray if it is missing).
- **`project-flow.html`**: A full, detailed, interactive system flow diagram showing all 5 steps of the daily/weekly pipeline, along with the specific news sources, weights, and automated screening strategies. Accessible via the "查看项目流程图" (View Project Flowchart) button on the main display page.

### Local Development / Preview

To view the display page and flowchart locally, you can open `index.html` using any local static server (e.g., VS Code's Live Server, or running `npx serve .`). Since it uses ES6 Modules, opening it via file protocol (`file://...`) directly in some browsers might trigger CORS restrictions, so a local server is recommended.

### Publishing to GitHub Pages

The project is pre-configured for seamless publication to GitHub Pages:

1. Push your code (including the tracked HTML output files in `output/`) to your GitHub repository.
2. In your repository on GitHub, go to **Settings** -> **Pages**.
3. Under **Build and deployment**, set the source to **Deploy from a branch**.
4. Select your primary branch (e.g., `master` or `main`) and root folder (`/`), then click **Save**.
5. Your interactive portal will be online in minutes at `https://<your-username>.github.io/<your-repo-name>/`.

## Scheduling

The project ships documentation-only scheduler examples and does not register OS schedules automatically.

```bash
npm run schedule:daily:example
```

Cron example:

```cron
0 8 * * * cd /path/to/ai-game-news-daily && npm run run-daily -- --mock
```

Windows Task Scheduler action:

```text
Program/script: powershell
Arguments: -NoProfile -ExecutionPolicy Bypass -Command "Set-Location 'C:\path\to\ai-game-news-daily'; npm run run-daily -- --mock"
```

## Troubleshooting

- `Only MOCK_MODE=true is implemented in the initial scaffold.`: the full `run-daily` pipeline is currently mock-only. Use `--mock` or set `MOCK_MODE=true`.
- `MODEL_PROVIDER=openai requires OPENAI_COMPATIBLE_API_KEY or OPENAI_API_KEY.`: configure an API key or use `MODEL_PROVIDER=mock`.
- `TTS_PROVIDER=... requires TTS_HTTP_ENDPOINT`: non-mock TTS requires the generic HTTP adapter endpoint.
- No selected items: lower thresholds, confirm source weights, check `audit/editorial-selection-audit.json`, and verify item dates are within `SELECTION_FRESHNESS_HOURS`.
- Duplicate items missing from output: review `duplicate` entries in the audit. Exact URL/content duplicates are skipped or grouped; near duplicates are marked by the 72-hour dedupe window.
- Video is JSON instead of a playable MP4: mock composer mode is active. Install `ffmpeg` and use `VIDEO_COMPOSER_MODE=ffmpeg` for real composition.
- Real provider smoke test: set OpenAI-compatible env vars and run `npm run test:llm`.

## Verification

Required checks:

```bash
npm run build
npm test
```
