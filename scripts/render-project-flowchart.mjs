import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const docBase = resolve("docs", "项目全流程高阶解构");
const width = 1840;
const height = 2860;

const laneDefs = [
  {
    key: "input",
    title: "输入层 Inputs",
    x: 80,
    width: 320,
    accent: "#68E0CF"
  },
  {
    key: "process",
    title: "处理主链路 Processing Pipeline",
    x: 450,
    width: 720,
    accent: "#F4C96C"
  },
  {
    key: "output",
    title: "输出层 Outputs",
    x: 1210,
    width: 280,
    accent: "#7CB7FF"
  },
  {
    key: "audit",
    title: "审计与治理 Audit / Governance",
    x: 1520,
    width: 240,
    accent: "#F4C96C"
  }
];

const cards = [
  {
    lane: "input",
    x: 100,
    y: 380,
    width: 280,
    height: 180,
    title: "命令入口",
    code: "src/cli/index.ts",
    lines: ["run-daily / collect / screen / select", "--mock / --date / --limit / --config"]
  },
  {
    lane: "input",
    x: 100,
    y: 590,
    width: 280,
    height: 180,
    title: "环境配置",
    code: "src/config/env.ts",
    lines: ["MOCK_MODE / MODEL_PROVIDER / TTS_PROVIDER", "输出目录、阈值、尺寸、上限参数"]
  },
  {
    lane: "input",
    x: 100,
    y: 800,
    width: 280,
    height: 190,
    title: "来源注册表",
    code: "src/config/sourceRegistry.ts",
    lines: ["source_group / source_type / priority", "source_weight / strategy / frequency"]
  },
  {
    lane: "input",
    x: 100,
    y: 1020,
    width: 280,
    height: 210,
    title: "外部内容输入",
    code: "src/collectors/*",
    lines: ["RSS / Web / JSON API / Markdown", "真实新闻源与手工补充内容"]
  },
  {
    lane: "input",
    x: 100,
    y: 1260,
    width: 280,
    height: 180,
    title: "Mock / Demo 数据",
    code: "src/collectors/demoCollector.ts",
    lines: ["本地稳定演练样本", "联动 mock AI / mock TTS / mock video"]
  },
  {
    lane: "process",
    x: 480,
    y: 380,
    width: 680,
    height: 150,
    title: "01 配置装配",
    code: "parseCliOptions -> buildConfig",
    lines: ["统一解析命令行、.env 和运行参数，生成可复用的 AppConfig。"]
  },
  {
    lane: "process",
    x: 480,
    y: 570,
    width: 680,
    height: 150,
    title: "02 多源采集",
    code: "src/collectors/*",
    lines: ["按 source registry 拉取 RSS、网页、JSON API 与 Markdown 内容。"]
  },
  {
    lane: "process",
    x: 480,
    y: 760,
    width: 680,
    height: 150,
    title: "03 入库与预去重",
    code: "SQLite + dedupe.ts",
    lines: ["标准化 URL、内容哈希、近似去重，并写入原始采集记录。"]
  },
  {
    lane: "process",
    x: 480,
    y: 950,
    width: 680,
    height: 150,
    title: "04 AI 筛选与增强",
    code: "src/pipeline/screening.ts",
    lines: ["摘要、关键词、分类、交叉相关度与新闻价值评分一次完成。"]
  },
  {
    lane: "process",
    x: 480,
    y: 1140,
    width: 680,
    height: 150,
    title: "05 选题与审核",
    code: "src/pipeline/selection.ts",
    lines: ["做可信度、时效性、分类配额与重复组胜出判断，产出正式入选结果。"]
  },
  {
    lane: "process",
    x: 480,
    y: 1330,
    width: 680,
    height: 150,
    title: "06 文本渲染",
    code: "src/render/markdownRenderer.ts",
    lines: ["输出日报 Markdown、知乎 Markdown 与公众号 HTML。"]
  },
  {
    lane: "process",
    x: 480,
    y: 1520,
    width: 680,
    height: 150,
    title: "07 视频脚本规划",
    code: "src/video/narrationPlanner.ts",
    lines: ["规划旁白脚本、时间轴、字幕与后续视频段落结构。"]
  },
  {
    lane: "process",
    x: 480,
    y: 1710,
    width: 680,
    height: 150,
    title: "08 TTS 与音频段",
    code: "src/video/ttsProvider.ts",
    lines: ["生成音频片段与字幕时间信息，供合成阶段直接消费。"]
  },
  {
    lane: "process",
    x: 480,
    y: 1900,
    width: 680,
    height: 150,
    title: "09 画面帧渲染",
    code: "src/video/frameRenderer.ts",
    lines: ["产出 frames/html 与 frames/png，为视频组合成准备视觉素材。"]
  },
  {
    lane: "process",
    x: 480,
    y: 2090,
    width: 680,
    height: 150,
    title: "10 视频合成与分发",
    code: "videoComposer.ts + exportPackages.ts",
    lines: ["生成 daily.mp4、平台元数据与 manifest，完成交付包装。"]
  },
  {
    lane: "output",
    x: 1230,
    y: 420,
    width: 240,
    height: 150,
    title: "文本资产",
    code: "daily.md / zhihu.md / wechat.html",
    lines: ["日报正文与多平台适配稿。"]
  },
  {
    lane: "output",
    x: 1230,
    y: 620,
    width: 240,
    height: 150,
    title: "审计文件",
    code: "audit/editorial-selection-audit.json",
    lines: ["保留入选、淘汰、重复与校验轨迹。"]
  },
  {
    lane: "output",
    x: 1230,
    y: 820,
    width: 240,
    height: 150,
    title: "音频与字幕",
    code: "audio/*.wav / subtitles.srt",
    lines: ["旁白音频、字幕与时间轴结果。"]
  },
  {
    lane: "output",
    x: 1230,
    y: 1020,
    width: 240,
    height: 150,
    title: "帧素材",
    code: "frames/html/* / frames/png/*",
    lines: ["封面、栏目、新闻卡与进度页。"]
  },
  {
    lane: "output",
    x: 1230,
    y: 1220,
    width: 240,
    height: 150,
    title: "视频成品",
    code: "daily.mp4",
    lines: ["最终视频或 mock 视频产物。"]
  },
  {
    lane: "output",
    x: 1230,
    y: 1420,
    width: 240,
    height: 170,
    title: "分发包",
    code: "distribution/* / manifest.json",
    lines: ["面向 B 站、YouTube、公众号、知乎等平台的交付内容。"]
  },
  {
    lane: "audit",
    x: 1540,
    y: 420,
    width: 220,
    height: 180,
    title: "来源治理",
    code: "source weight / priority / strategy",
    lines: ["把输入从“盲抓新闻”升级为“可配置、可治理的来源网络”。"]
  },
  {
    lane: "audit",
    x: 1540,
    y: 640,
    width: 220,
    height: 180,
    title: "质量控制",
    code: "thresholds / exclusions / verification",
    lines: ["通过阈值、排除规则与验证逻辑控制内容质量。"]
  },
  {
    lane: "audit",
    x: 1540,
    y: 860,
    width: 220,
    height: 180,
    title: "重复治理",
    code: "SQLite repository",
    lines: ["保留 duplicateOf 关系，避免同题重复进入日报。"]
  },
  {
    lane: "audit",
    x: 1540,
    y: 1080,
    width: 220,
    height: 180,
    title: "运行审计",
    code: "pipeline-run.json",
    lines: ["记录每个 stage 的输入、输出、错误和产物路径。"]
  },
  {
    lane: "audit",
    x: 1540,
    y: 1300,
    width: 220,
    height: 180,
    title: "内容生产基础设施",
    code: "content pipeline",
    lines: ["整条链路支持重复执行、问题追踪和后续扩展。"]
  }
];

const arrows = [
  { from: [380, 470], to: [480, 455] },
  { from: [820, 530], to: [820, 570] },
  { from: [820, 720], to: [820, 760] },
  { from: [820, 910], to: [820, 950] },
  { from: [820, 1100], to: [820, 1140] },
  { from: [820, 1290], to: [820, 1330] },
  { from: [820, 1480], to: [820, 1520] },
  { from: [820, 1670], to: [820, 1710] },
  { from: [820, 1860], to: [820, 1900] },
  { from: [820, 2050], to: [820, 2090] },
  { from: [1160, 1405], to: [1230, 495] },
  { from: [1160, 1405], to: [1230, 695] },
  { from: [1160, 1595], to: [1230, 895] },
  { from: [1160, 1975], to: [1230, 1095] },
  { from: [1160, 2165], to: [1230, 1295] },
  { from: [1160, 2165], to: [1230, 1505] },
  { from: [1470, 495], to: [1540, 510] },
  { from: [1470, 695], to: [1540, 730] },
  { from: [1470, 895], to: [1540, 950] },
  { from: [1470, 1295], to: [1540, 1170] },
  { from: [1470, 1505], to: [1540, 1390] }
];

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapLine(text, maxChars) {
  if (text.length <= maxChars) {
    return [text];
  }

  const parts = [];
  let cursor = 0;
  while (cursor < text.length) {
    parts.push(text.slice(cursor, cursor + maxChars));
    cursor += maxChars;
  }
  return parts;
}

function renderCardHtml(card) {
  return `<article class="card ${card.lane}" style="left:${card.x}px;top:${card.y}px;width:${card.width}px;height:${card.height}px;">
    <h2>${escapeHtml(card.title)}</h2>
    <div class="code">${escapeHtml(card.code)}</div>
    ${card.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
  </article>`;
}

function renderHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>项目全流程高阶解构</title>
  <style>
    :root {
      --bg: #08111f;
      --bg-soft: #0f1b2f;
      --panel: rgba(255, 255, 255, 0.03);
      --card: linear-gradient(135deg, #18365c 0%, #142846 100%);
      --process: linear-gradient(135deg, #183760 0%, #172b4c 100%);
      --text: #f5f7fb;
      --muted: #b9c7df;
      --line: #73dbc9;
      --shadow: 0 22px 60px rgba(2, 6, 14, 0.35);
      --radius: 28px;
      --sans: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
      --mono: "JetBrains Mono", "Consolas", monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--sans);
      color: var(--text);
      background:
        radial-gradient(circle at 82% 14%, rgba(104, 224, 207, 0.08), transparent 18%),
        radial-gradient(circle at 12% 88%, rgba(244, 201, 108, 0.08), transparent 22%),
        linear-gradient(180deg, var(--bg) 0%, #091423 100%);
    }
    .page { min-height: 100vh; padding: 24px 20px 40px; }
    .hero {
      max-width: ${width}px;
      margin: 0 auto 24px;
      padding: 28px 32px;
      border-radius: 30px;
      background: linear-gradient(135deg, rgba(20, 39, 67, 0.96), rgba(13, 25, 48, 0.92));
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: var(--shadow);
    }
    .bar {
      width: 200px;
      height: 12px;
      border-radius: 999px;
      background: linear-gradient(90deg, #68E0CF, #F4C96C);
      margin-bottom: 22px;
    }
    h1 { margin: 0 0 10px; font-size: 44px; line-height: 1.15; }
    .hero p { margin: 0; color: var(--muted); font-size: 18px; line-height: 1.7; }
    .canvas-shell { max-width: ${width}px; margin: 0 auto; overflow-x: auto; }
    .canvas {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      border-radius: 36px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .lane-title {
      position: absolute;
      top: 34px;
      padding: 16px 22px;
      border-radius: 20px;
      font-size: 22px;
      font-weight: 700;
      color: #09111e;
      box-shadow: 0 10px 24px rgba(2, 6, 14, 0.2);
    }
    .lane-panel {
      position: absolute;
      top: 108px;
      bottom: 40px;
      border-radius: 32px;
      background: var(--panel);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .arrow-layer { position: absolute; inset: 0; z-index: 1; }
    .arrow {
      fill: none;
      stroke: var(--line);
      stroke-width: 4;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.92;
      marker-end: url(#arrowhead);
    }
    .card {
      position: absolute;
      z-index: 2;
      padding: 24px 26px;
      border-radius: var(--radius);
      background: var(--card);
      border: 1px solid rgba(120, 183, 255, 0.22);
      box-shadow: var(--shadow);
    }
    .card.process { background: var(--process); }
    .card h2 { margin: 0 0 10px; font-size: 26px; line-height: 1.25; }
    .card .code { margin-bottom: 12px; color: #82dccf; font-family: var(--mono); font-size: 14px; }
    .card p { margin: 0 0 8px; color: var(--muted); font-size: 16px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <div class="bar"></div>
      <h1>项目全流程高阶解构图</h1>
      <p>基于当前仓库实现重新整理的流程图，覆盖输入、处理、输出与治理四层，替换掉原先中文乱码的 Mermaid 导出产物。</p>
    </section>
    <div class="canvas-shell">
      <section class="canvas" aria-label="项目全流程高阶解构流程图">
        ${laneDefs.map((lane) => `<div class="lane-title" style="left:${lane.x}px;width:${lane.width}px;background:${lane.accent};">${escapeHtml(lane.title)}</div>`).join("")}
        ${laneDefs.map((lane) => `<div class="lane-panel" style="left:${lane.x - 20}px;width:${lane.width + 40}px;border-color:${lane.accent}55;"></div>`).join("")}
        <svg class="arrow-layer" viewBox="0 0 ${width} ${height}" aria-hidden="true">
          <defs>
            <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#73dbc9"></path>
            </marker>
          </defs>
          ${arrows.map((arrow) => `<path class="arrow" d="M ${arrow.from[0]} ${arrow.from[1]} L ${arrow.to[0]} ${arrow.to[1]}" />`).join("")}
        </svg>
        ${cards.map(renderCardHtml).join("")}
      </section>
    </div>
  </div>
</body>
</html>
`;
}

function renderSvgTextBlock(x, y, lines, className, lineHeight = 30) {
  return `<text x="${x}" y="${y}" class="${className}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeHtml(line)}</tspan>`).join("")}</text>`;
}

function renderCardSvg(card) {
  const bodyLines = card.lines.flatMap((line) => wrapLine(line, 24));
  return `
  <rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="28" fill="${card.lane === "process" ? "url(#processCard)" : "url(#card)"}" stroke="rgba(120,183,255,0.28)" />
  ${renderSvgTextBlock(card.x + 24, card.y + 42, [card.title], "card-title")}
  ${renderSvgTextBlock(card.x + 24, card.y + 74, [card.code], "card-code", 24)}
  ${renderSvgTextBlock(card.x + 24, card.y + 112, bodyLines, "card-body", 28)}`;
}

function renderSvg() {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#08111F"/>
      <stop offset="1" stop-color="#0A1424"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#142743"/>
      <stop offset="1" stop-color="#0D1930"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#16365B"/>
      <stop offset="1" stop-color="#132747"/>
    </linearGradient>
    <linearGradient id="processCard" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#183760"/>
      <stop offset="1" stop-color="#172B4C"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="22" flood-color="#02060E" flood-opacity="0.35"/>
    </filter>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10Z" fill="#73DBC9"/>
    </marker>
    <style>
      .title { font: 700 56px 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif; fill: #F5F7FB; }
      .subtitle { font: 400 24px 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif; fill: #B9C7DF; }
      .lane { font: 700 24px 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif; fill: #09111E; }
      .card-title { font: 700 26px 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif; fill: #F5F7FB; }
      .card-code { font: 400 14px 'JetBrains Mono', 'Consolas', monospace; fill: #82DCCF; }
      .card-body { font: 400 16px 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', sans-serif; fill: #B9C7DF; }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="20" y="20" width="${width - 40}" height="180" rx="30" fill="url(#panel)" filter="url(#shadow)"/>
  <rect x="52" y="50" width="200" height="12" rx="6" fill="#68E0CF"/>
  <text x="52" y="132" class="title">项目全流程高阶解构图</text>
  <text x="52" y="170" class="subtitle">覆盖输入、处理、输出与治理四层，替换原先中文乱码的流程图导出产物。</text>
  ${laneDefs.map((lane) => `
  <rect x="${lane.x}" y="244" width="${lane.width}" height="64" rx="20" fill="${lane.accent}"/>
  <text x="${lane.x + 20}" y="285" class="lane">${escapeHtml(lane.title)}</text>
  <rect x="${lane.x - 20}" y="344" width="${lane.width + 40}" height="${height - 404}" rx="32" fill="#FFFFFF08" stroke="${lane.accent}66"/>`).join("")}
  ${cards.map(renderCardSvg).join("")}
  ${arrows.map((arrow) => `<path d="M ${arrow.from[0]} ${arrow.from[1]} L ${arrow.to[0]} ${arrow.to[1]}" stroke="#73DBC9" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrow)"/>`).join("")}
</svg>
`;
}

function renderMarkdown() {
  return `# 项目全流程高阶解构

已修复原流程图中文乱码问题，并基于当前仓库实现重新生成以下产物：

- HTML 版：[\`项目全流程高阶解构.html\`](./项目全流程高阶解构.html)
- SVG 版：[\`项目全流程高阶解构.svg\`](./项目全流程高阶解构.svg)
- PNG 版：[\`项目全流程高阶解构.png\`](./项目全流程高阶解构.png)

说明：

- 流程图按“输入层 / 处理主链路 / 输出层 / 审计与治理”四列组织。
- 处理链路覆盖从采集、入库、筛选、选题到文本、音频、画面、视频和分发的完整路径。
- 文本内容直接根据当前仓库模块整理，不再依赖已经损坏的旧 Mermaid 导出文本。
`;
}

async function renderPng(htmlPath) {
  const playwright = await import("playwright-core");
  const browser = await playwright.chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${docBase}.png`, type: "png" });
  } finally {
    await browser.close();
  }
}

async function main() {
  const htmlPath = `${docBase}.html`;
  await writeFile(`${docBase}.md`, renderMarkdown(), "utf8");
  await writeFile(htmlPath, renderHtml(), "utf8");
  await writeFile(`${docBase}.svg`, renderSvg(), "utf8");
  await renderPng(htmlPath);
  console.log("Rendered flowchart assets:", `${docBase}.md`, htmlPath, `${docBase}.svg`, `${docBase}.png`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
