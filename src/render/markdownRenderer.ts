import type { NewsItem } from "../pipeline/types.js";

export interface DailyTextRenderOptions {
  title?: string;
}

interface RenderItem {
  item: NewsItem;
  anchor: string;
}

export function renderDailyMarkdown(items: NewsItem[], generatedAt: string, options: DailyTextRenderOptions = {}): string {
  const compactDate = formatDate(generatedAt).replace(/-/g, "");
  const title = options.title ?? `智游镜 | 每日AI游戏新闻速递 ${compactDate}`;
  const date = formatDate(generatedAt);
  const groupedItems = groupRenderItems(items);
  const lines = [
    `# ${escapeMarkdownInline(title)}`,
    "",
    `Date: ${date}`,
    "",
    "## Summary",
    ""
  ];

  if (items.length === 0) {
    lines.push("No AI x game topic candidates met the configured threshold.", "");
  } else {
    for (const item of items) {
      lines.push(`- **${escapeMarkdownInline(item.articleTitle)}**: ${escapeMarkdownInline(firstNonEmpty(item.introSummary, item.summary))}`);
    }
    lines.push("");
  }

  lines.push("## Table of Contents", "");
  for (const [category, renderItems] of groupedItems) {
    lines.push(`- [${escapeMarkdownInline(category)}](#${renderItems[0]?.anchor.split("--")[0] ?? slugify(category)})`);
    for (const renderItem of renderItems) {
      lines.push(`  - [${escapeMarkdownInline(renderItem.item.articleTitle)}](#${renderItem.anchor})`);
    }
  }
  lines.push("");

  for (const [category, renderItems] of groupedItems) {
    lines.push(`## ${escapeMarkdownInline(category)}`, "");
    for (const { item, anchor } of renderItems) {
      lines.push(
        `<a id="${escapeHtmlAttribute(anchor)}"></a>`,
        "",
        `### ${escapeMarkdownInline(item.articleTitle)}`,
        "",
        `*小编评论：${escapeMarkdownInline(firstNonEmpty(item.introSummary, item.summary))}*`,
        `- Source: ${formatMarkdownLink(item.sourceName, item.sourceUrl)}`,
        `- Published: ${formatDateTime(item.publishedAt)}`,
        `- Score: ${item.crossRelevanceScore}`,
        `- Tags: ${[...item.aiTags, ...item.gameTags].map(escapeMarkdownInline).join(", ") || "None"}`,
        "",
        normalizeMarkdownBody(item.articleBody),
        "",
        "Sources:",
        ...sourceLinks(item).map((source, index) => `${index + 1}. ${formatMarkdownLink(source.label, source.url)}`),
        ""
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderZhihuMarkdown(items: NewsItem[], generatedAt: string, options: DailyTextRenderOptions = {}): string {
  const compactDate = formatDate(generatedAt).replace(/-/g, "");
  const title = options.title ?? `智游镜 | 每日AI游戏新闻速递 ${compactDate}`;
  const date = formatDate(generatedAt);
  const groupedItems = groupRenderItems(items);
  const lines = [
    `# ${escapeMarkdownInline(title)}`,
    "",
    `> ${date}`,
    "",
    "## \u4eca\u65e5\u8981\u70b9",
    ""
  ];

  if (items.length === 0) {
    lines.push("今天没有达到阈值的 AI x 游戏候选新闻。", "");
  } else {
    for (const item of items) {
      lines.push(`- **${escapeMarkdownInline(item.articleTitle)}**：${escapeMarkdownInline(firstNonEmpty(item.introSummary, item.summary))}`);
    }
    lines.push("");
  }

    lines.push("## \u76ee\u5f55", "");
  for (const [category, renderItems] of groupedItems) {
    lines.push(`- ${escapeMarkdownInline(category)}`);
    for (const renderItem of renderItems) {
      lines.push(`  - ${escapeMarkdownInline(renderItem.item.articleTitle)}`);
    }
  }
  lines.push("");

  for (const [category, renderItems] of groupedItems) {
    lines.push(`## ${escapeMarkdownInline(category)}`, "");
    for (const { item } of renderItems) {
      lines.push(
        `### ${escapeMarkdownInline(item.articleTitle)}`,
        "",
        `**\u70b9\u8bc4**\uff1a${escapeMarkdownInline(firstNonEmpty(item.introSummary, item.summary))}`,
        "",
        normalizeZhihuBody(item.articleBody),
        "",
        `**\u6765\u6e90**\uff1a${sourceLinks(item).map((source) => formatMarkdownLink(source.label, source.url)).join(" / ")}`,
        ""
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderWeChatHtml(items: NewsItem[], generatedAt: string, options: DailyTextRenderOptions = {}): string {
  const compactDate = formatDate(generatedAt).replace(/-/g, "");
  const title = options.title ?? `智游镜 | 每日AI游戏新闻速递 ${compactDate}`;
  const date = formatDate(generatedAt);
  const groupedItems = groupRenderItems(items);
  const body: string[] = [
    `<section style="${containerStyle}">`,
    `<h1 style="${h1Style}">${escapeHtml(title)}</h1>`,
    `<p style="${mutedStyle}">${escapeHtml(date)}</p>`,
    `<h2 style="${h2Style}">Summary</h2>`
  ];

  if (items.length === 0) {
    body.push(`<p style="${paragraphStyle}">No AI x game topic candidates met the configured threshold.</p>`);
  } else {
    body.push(`<ul style="${listStyle}">`);
    for (const item of items) {
      body.push(`<li style="${listItemStyle}"><strong>${escapeHtml(item.articleTitle)}</strong>: ${escapeHtml(firstNonEmpty(item.introSummary, item.summary))}</li>`);
    }
    body.push("</ul>");
  }

  body.push(`<h2 style="${h2Style}">Table of Contents</h2>`, `<ol style="${listStyle}">`);
  for (const [category, renderItems] of groupedItems) {
    body.push(`<li style="${listItemStyle}">${escapeHtml(category)}<ol style="${nestedListStyle}">`);
    for (const { item } of renderItems) {
      body.push(`<li style="${listItemStyle}">${escapeHtml(item.articleTitle)}</li>`);
    }
    body.push("</ol></li>");
  }
  body.push("</ol>");

  for (const [category, renderItems] of groupedItems) {
    body.push(`<h2 style="${h2Style}">${escapeHtml(category)}</h2>`);
    for (const { item } of renderItems) {
      body.push(
        `<h3 style="${h3Style}">${escapeHtml(item.articleTitle)}</h3>`,
        `<p style="${summaryStyle}"><strong>\u70b9\u8bc4\uff1a</strong> ${escapeHtml(firstNonEmpty(item.introSummary, item.summary))}</p>`,
        `<p style="${mutedStyle}">Published: ${escapeHtml(formatDateTimeToHour(item.publishedAt))} | Score: ${escapeHtml(String(item.crossRelevanceScore))}</p>`,
        renderMarkdownSubsetToHtml(item.articleBody),
        `<p style="${sourceStyle}"><strong>Sources:</strong> ${sourceLinks(item).map(renderHtmlLink).join(" ")}</p>`
      );
    }
  }

  body.push("</section>");

  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body.join("\n")}</body></html>\n`;
}

export function renderWeeklyMarkdown(items: NewsItem[], generatedAt: string, startDateStr: string, endDateStr: string, options: DailyTextRenderOptions = {}): string {
  const compactDate = formatDate(generatedAt).replace(/-/g, "");
  const title = options.title ?? `智游镜 | 每周AI游戏新闻速递 ${compactDate}`;
  const dateRange = `${startDateStr} to ${endDateStr}`;
  const groupedItems = groupRenderItems(items);
  const lines = [
    `# ${escapeMarkdownInline(title)}`,
    "",
    `Period: ${dateRange}`,
    "",
    "## Weekly Highlights",
    ""
  ];

  if (items.length === 0) {
    lines.push("No AI x game topic candidates were selected during this week.", "");
  } else {
    for (const item of items) {
      lines.push(`- **${escapeMarkdownInline(item.articleTitle)}**: ${escapeMarkdownInline(firstNonEmpty(item.introSummary, item.summary))}`);
    }
    lines.push("");
  }

  lines.push("## Table of Contents", "");
  for (const [category, renderItems] of groupedItems) {
    lines.push(`- [${escapeMarkdownInline(category)}](#${renderItems[0]?.anchor.split("--")[0] ?? slugify(category)})`);
    for (const renderItem of renderItems) {
      lines.push(`  - [${escapeMarkdownInline(renderItem.item.articleTitle)}](#${renderItem.anchor})`);
    }
  }
  lines.push("");

  for (const [category, renderItems] of groupedItems) {
    lines.push(`## ${escapeMarkdownInline(category)}`, "");
    for (const { item, anchor } of renderItems) {
      lines.push(
        `<a id="${escapeHtmlAttribute(anchor)}"></a>`,
        "",
        `### ${escapeMarkdownInline(item.articleTitle)}`,
        "",
        `*小编点评：${escapeMarkdownInline(firstNonEmpty(item.introSummary, item.summary))}*`,
        `- Source: ${formatMarkdownLink(item.sourceName, item.sourceUrl)}`,
        `- Published: ${formatDateTime(item.publishedAt)}`,
        `- Score: ${item.crossRelevanceScore}`,
        `- Tags: ${[...item.aiTags, ...item.gameTags].map(escapeMarkdownInline).join(", ") || "None"}`,
        "",
        normalizeMarkdownBody(item.articleBody),
        "",
        "Sources:",
        ...sourceLinks(item).map((source, index) => `${index + 1}. ${formatMarkdownLink(source.label, source.url)}`),
        ""
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderWeeklyHtml(items: NewsItem[], generatedAt: string, startDateStr: string, endDateStr: string, options: DailyTextRenderOptions = {}): string {
  const compactDate = formatDate(generatedAt).replace(/-/g, "");
  const title = options.title ?? `智游镜 | 每周AI游戏新闻速递 ${compactDate}`;
  const dateRange = `${startDateStr} to ${endDateStr}`;
  const groupedItems = groupRenderItems(items);
  const body: string[] = [
    `<section style="${containerStyle}">`,
    `<h1 style="${h1Style}">${escapeHtml(title)}</h1>`,
    `<p style="${mutedStyle}">Period: ${escapeHtml(dateRange)}</p>`,
    `<h2 style="${h2Style}">Weekly Highlights</h2>`
  ];

  if (items.length === 0) {
    body.push(`<p style="${paragraphStyle}">No AI x game topic candidates were selected during this week.</p>`);
  } else {
    body.push(`<ul style="${listStyle}">`);
    for (const item of items) {
      body.push(`<li style="${listItemStyle}"><strong>${escapeHtml(item.articleTitle)}</strong>: ${escapeHtml(firstNonEmpty(item.introSummary, item.summary))}</li>`);
    }
    body.push("</ul>");
  }

  body.push(`<h2 style="${h2Style}">Table of Contents</h2>`, `<ol style="${listStyle}">`);
  for (const [category, renderItems] of groupedItems) {
    body.push(`<li style="${listItemStyle}">${escapeHtml(category)}<ol style="${nestedListStyle}">`);
    for (const { item } of renderItems) {
      body.push(`<li style="${listItemStyle}">${escapeHtml(item.articleTitle)}</li>`);
    }
    body.push("</ol></li>");
  }
  body.push("</ol>");

  for (const [category, renderItems] of groupedItems) {
    body.push(`<h2 style="${h2Style}">${escapeHtml(category)}</h2>`);
    for (const { item } of renderItems) {
      body.push(
        `<h3 style="${h3Style}">${escapeHtml(item.articleTitle)}</h3>`,
        `<p style="${summaryStyle}"><strong>点评：</strong> ${escapeHtml(firstNonEmpty(item.introSummary, item.summary))}</p>`,
        `<p style="${mutedStyle}">Published: ${escapeHtml(formatDateTimeToHour(item.publishedAt))} | Score: ${escapeHtml(String(item.crossRelevanceScore))}</p>`,
        renderMarkdownSubsetToHtml(item.articleBody),
        `<p style="${sourceStyle}"><strong>Sources:</strong> ${sourceLinks(item).map(renderHtmlLink).join(" ")}</p>`
      );
    }
  }

  body.push("</section>");

  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body.join("\n")}</body></html>\n`;
}

function formatMarkdownLink(label: string, url: string): string {
  return `[${escapeMarkdownInline(label)}](<${escapeMarkdownUrl(url)}>)`;
}

function escapeMarkdownInline(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

function escapeMarkdownUrl(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "%5C")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/\s/g, "%20");
}

function groupRenderItems(items: NewsItem[]): Map<string, RenderItem[]> {
  const grouped = new Map<string, RenderItem[]>();
  const usedAnchors = new Map<string, number>();

  for (const item of items) {
    const category = item.category.trim() || "Uncategorized";
    const categoryAnchor = slugify(category);
    const baseAnchor = `${categoryAnchor}--${slugify(item.articleTitle || item.id)}`;
    const count = usedAnchors.get(baseAnchor) ?? 0;
    usedAnchors.set(baseAnchor, count + 1);
    const anchor = count === 0 ? baseAnchor : `${baseAnchor}-${count + 1}`;
    grouped.set(category, [...(grouped.get(category) ?? []), { item, anchor }]);
  }

  return grouped;
}

function sourceLinks(item: NewsItem): Array<{ label: string; url: string }> {
  const links = new Map<string, { label: string; url: string }>();
  for (const [label, url] of [[item.sourceName, item.sourceUrl], ...item.officialSources.map((source, index) => [`Official ${index + 1}`, source] as const)] as const) {
    if (isSafeHttpUrl(url)) {
      const canonical = canonicalizeSourceUrl(url);
      if (!links.has(canonical)) {
        links.set(canonical, { label: label || url, url });
      }
    }
  }
  return [...links.values()];
}

function canonicalizeSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();

    for (const param of Array.from(parsed.searchParams.keys())) {
      if (param.toLowerCase().startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(param.toLowerCase())) {
        parsed.searchParams.delete(param);
      }
    }

    const sortedParams = Array.from(parsed.searchParams.entries()).sort(([left], [right]) => left.localeCompare(right));
    parsed.search = "";
    for (const [key, value] of sortedParams) {
      parsed.searchParams.append(key, value);
    }

    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim().toLowerCase();
  }
}

function normalizeMarkdownBody(value: string): string {
  return value.trim() || "_No article body was generated._";
}

function normalizeZhihuBody(value: string): string {
  return normalizeMarkdownBody(value).replace(/<a\s+id="[^"]*"><\/a>\n*/gi, "");
}

function firstNonEmpty(...values: string[]): string {
  return values.map((value) => value.trim()).find(Boolean) ?? "No summary was generated.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function formatDateTimeToHour(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toISOString().slice(0, 13).replace("T", " ")}:00`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function renderHtmlLink(source: { label: string; url: string }): string {
  return `<a href="${escapeHtmlAttribute(source.url)}" style="${linkStyle}">${escapeHtml(source.label)}</a>`;
}

function renderMarkdownSubsetToHtml(markdown: string): string {
  const lines = normalizeMarkdownBody(markdown).split(/\r?\n/);
  const html: string[] = [];
  let paragraph: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let tableLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      html.push(`<p style="${paragraphStyle}">${formatInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (listItems.length > 0) {
      html.push(`<ul style="${listStyle}">${listItems.map((item) => `<li style="${listItemStyle}">${formatInlineMarkdown(item)}</li>`).join("")}</ul>`);
      listItems = [];
    }
  };
  const flushTable = (): void => {
    if (tableLines.length > 0) {
      html.push(renderTable(tableLines));
      tableLines = [];
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      flushTable();
      if (inCode) {
        html.push(`<pre style="${preStyle}"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
      }
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph();
      flushList();
      tableLines.push(line);
      continue;
    }

    flushTable();

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(3, heading[1]!.length + 2);
      const style = level === 3 ? h3Style : paragraphStyle;
      html.push(`<h${level} style="${style}">${formatInlineMarkdown(heading[2]!)}</h${level}>`);
      continue;
    }

    const list = /^\s*[-*]\s+(.+)$/.exec(line);
    if (list) {
      flushParagraph();
      listItems.push(list[1]!);
      continue;
    }

    const numberedPoint = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (numberedPoint) {
      flushParagraph();
      flushList();
      html.push(`<p style="${paragraphStyle}">${formatInlineMarkdown(line.trim())}</p>`);
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushTable();

  if (inCode) {
    html.push(`<pre style="${preStyle}"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  return html.join("\n");
}

function renderTable(lines: string[]): string {
  const rows = lines
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
    .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
  if (rows.length === 0) {
    return "";
  }
  return `<table style="${tableStyle}">${rows.map((row, rowIndex) => `<tr>${row.map((cell) => rowIndex === 0 ? `<th style="${thStyle}">${formatInlineMarkdown(cell)}</th>` : `<td style="${tdStyle}">${formatInlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</table>`;
}

function formatInlineMarkdown(value: string): string {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, `<code style="${codeStyle}">$1</code>`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

const containerStyle = "max-width:680px;margin:0 auto;padding:24px 16px;color:#1f2933;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.75;background:#ffffff;";
const h1Style = "font-size:26px;line-height:1.3;font-weight:700;margin:0 0 12px;color:#111827;";
const h2Style = "font-size:20px;line-height:1.4;font-weight:700;margin:28px 0 12px;color:#0f172a;border-left:4px solid #2563eb;padding-left:10px;";
const h3Style = "font-size:17px;line-height:1.5;font-weight:700;margin:22px 0 10px;color:#1f2937;";
const paragraphStyle = "font-size:15px;line-height:1.8;margin:12px 0;color:#263238;";
const summaryStyle = "font-size:15px;line-height:1.8;margin:10px 0;padding:10px 12px;background:#f8fafc;color:#263238;border-left:3px solid #94a3b8;";
const mutedStyle = "font-size:13px;line-height:1.6;margin:6px 0;color:#64748b;";
const sourceStyle = "font-size:13px;line-height:1.7;margin:14px 0 22px;color:#475569;";
const listStyle = "margin:10px 0 14px;padding-left:20px;color:#263238;";
const nestedListStyle = "margin:6px 0 8px;padding-left:18px;color:#475569;";
const listItemStyle = "font-size:15px;line-height:1.75;margin:4px 0;";
const linkStyle = "color:#2563eb;text-decoration:none;word-break:break-all;";
const preStyle = "font-size:13px;line-height:1.6;margin:12px 0;padding:12px;background:#f1f5f9;color:#0f172a;white-space:pre-wrap;word-break:break-word;";
const codeStyle = "font-size:13px;background:#eef2f7;color:#b91c1c;padding:1px 4px;border-radius:3px;";
const tableStyle = "width:100%;border-collapse:collapse;margin:12px 0;font-size:13px;line-height:1.6;color:#263238;";
const thStyle = "border:1px solid #cbd5e1;padding:6px 8px;background:#f8fafc;font-weight:700;text-align:left;";
const tdStyle = "border:1px solid #cbd5e1;padding:6px 8px;text-align:left;";
