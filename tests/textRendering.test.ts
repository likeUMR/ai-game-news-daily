import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { openNewsRepository } from "../src/db/newsRepository.js";
import { runTextRendering } from "../src/pipeline/textRendering.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("runTextRendering", () => {
  test("creates dated text outputs and generated output records from mock data", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "news-text-rendering-"));
    const databasePath = join(tempDir, "data", "news.sqlite");
    const config = loadConfig({
      NODE_ENV: "test",
      MOCK_MODE: "true",
      OUTPUT_DIR: join(tempDir, "output"),
      DATA_DIR: join(tempDir, "data"),
      DATABASE_PATH: databasePath,
      MIN_CROSS_RELEVANCE_SCORE: "60"
    });

    const result = await runTextRendering(config);

    expect(result.outputDir).toMatch(/output[\\/]\d{4}-\d{2}-\d{2}$/);
    expect(existsSync(result.dailyMarkdownPath)).toBe(true);
    expect(existsSync(result.zhihuMarkdownPath)).toBe(true);
    expect(existsSync(result.wechatHtmlPath)).toBe(true);

    const daily = await readFile(result.dailyMarkdownPath, "utf8");
    const zhihu = await readFile(result.zhihuMarkdownPath, "utf8");
    const wechat = await readFile(result.wechatHtmlPath, "utf8");

    expect(daily).toContain("*小编评论：");
    expect(daily).toContain("## Table of Contents");
    expect(daily).toContain("https://example.com/pixel2play-release");
    expect(zhihu).toContain("**点评**：");
    expect(wechat).toContain("点评：");
    expect(wechat).toContain("<!doctype html>");

    const repository = openNewsRepository(databasePath);
    try {
      const outputs = repository.listGeneratedOutputs(result.runId);
      expect(outputs.map((output) => output.outputType).sort()).toEqual([
        "html_wechat",
        "markdown_daily",
        "markdown_zhihu"
      ]);
      expect(outputs.every((output) => output.outputPath?.startsWith(result.outputDir))).toBe(true);
    } finally {
      repository.close();
    }
  });
});
