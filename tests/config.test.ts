import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { loadConfig, loadEnvFiles } from "../src/config/env.js";

describe("loadConfig", () => {
  test("uses production defaults", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      APP_ROOT: "C:\\tmp\\news-daily-test"
    });

    expect(config.MOCK_MODE).toBe(false);
    expect(config.MODEL_PROVIDER).toBe("openai");
    expect(config.TTS_PROVIDER).toBe("mock");
    expect(config.COLLECTION_WINDOW_HOURS).toBe(24);
    expect(config.DEDUPE_WINDOW_HOURS).toBe(72);
    expect(config.MIN_AI_RELEVANCE_SCORE).toBe(50);
    expect(config.MIN_GAME_RELEVANCE_SCORE).toBe(50);
    expect(config.MIN_CROSS_RELEVANCE_SCORE).toBe(60);
    expect(config.DAILY_ITEM_COUNT).toBe(5);
    expect(config.DAILY_CATEGORY_COUNTS).toBe("AI x Game=5");
    expect(config.LOW_TRUST_SOURCE_WEIGHT).toBe(40);
    expect(config.LOW_TRUST_HIGH_SCORE).toBe(85);
    expect(config.SELECTION_FRESHNESS_HOURS).toBe(72);
    expect(config.MAX_ITEMS_PER_SOURCE).toBe(50);
    expect(config.MAX_ITEMS_TOTAL).toBe(500);
    expect(config.DATABASE_PATH).toBe(join(config.DATA_DIR, "news-daily.sqlite"));
  });

  test("allows environment overrides", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      APP_ROOT: "C:\\tmp\\news-daily-prod",
      MOCK_MODE: "false",
      DATA_DIR: "runtime-data",
      OUTPUT_DIR: "public-output",
      DATABASE_PATH: "runtime-data\\custom.sqlite",
      COLLECTION_WINDOW_HOURS: "12",
      DEDUPE_WINDOW_HOURS: "48",
      MODEL_PROVIDER: "openai",
      TTS_PROVIDER: "edge",
      MIN_AI_RELEVANCE_SCORE: "55",
      MIN_GAME_RELEVANCE_SCORE: "45",
      MIN_CROSS_RELEVANCE_SCORE: "70",
      DAILY_ITEM_COUNT: "7",
      DAILY_CATEGORY_COUNTS: "AI x Game=4,Engine=3",
      LOW_TRUST_SOURCE_WEIGHT: "35",
      LOW_TRUST_HIGH_SCORE: "90",
      SELECTION_FRESHNESS_HOURS: "48",
      MAX_ITEMS_PER_SOURCE: "25",
      MAX_ITEMS_TOTAL: "250"
    });

    expect(config.MOCK_MODE).toBe(false);
    expect(config.MODEL_PROVIDER).toBe("openai");
    expect(config.TTS_PROVIDER).toBe("edge");
    expect(config.DATA_DIR).toContain("runtime-data");
    expect(config.OUTPUT_DIR).toContain("public-output");
    expect(config.DATABASE_PATH).toContain("custom.sqlite");
    expect(config.COLLECTION_WINDOW_HOURS).toBe(12);
    expect(config.DEDUPE_WINDOW_HOURS).toBe(48);
    expect(config.MIN_AI_RELEVANCE_SCORE).toBe(55);
    expect(config.MIN_GAME_RELEVANCE_SCORE).toBe(45);
    expect(config.MIN_CROSS_RELEVANCE_SCORE).toBe(70);
    expect(config.DAILY_ITEM_COUNT).toBe(7);
    expect(config.DAILY_CATEGORY_COUNTS).toBe("AI x Game=4,Engine=3");
    expect(config.LOW_TRUST_SOURCE_WEIGHT).toBe(35);
    expect(config.LOW_TRUST_HIGH_SCORE).toBe(90);
    expect(config.SELECTION_FRESHNESS_HOURS).toBe(48);
    expect(config.MAX_ITEMS_PER_SOURCE).toBe(25);
    expect(config.MAX_ITEMS_TOTAL).toBe(250);
  });

  test("loads .env and .env.local without overriding existing environment values", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "news-env-"));
    try {
      await writeFile(join(tempDir, ".env"), [
        "MODEL_PROVIDER=mock",
        "OPENAI_COMPATIBLE_BASE_URL=https://from-env.example/v1",
        "OPENAI_COMPATIBLE_MODEL=env-model"
      ].join("\n"), "utf8");
      await writeFile(join(tempDir, ".env.local"), [
        "MODEL_PROVIDER=openai",
        "OPENAI_COMPATIBLE_BASE_URL=https://from-local.example/v1",
        "OPENAI_COMPATIBLE_API_KEY=local-key"
      ].join("\n"), "utf8");

      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "test",
        APP_ROOT: tempDir,
        OPENAI_COMPATIBLE_MODEL: "process-model"
      };
      loadEnvFiles(tempDir, env);

      expect(env.MODEL_PROVIDER).toBe("openai");
      expect(env.OPENAI_COMPATIBLE_BASE_URL).toBe("https://from-local.example/v1");
      expect(env.OPENAI_COMPATIBLE_API_KEY).toBe("local-key");
      expect(env.OPENAI_COMPATIBLE_MODEL).toBe("process-model");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("reports clear validation errors", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        COLLECTION_WINDOW_HOURS: "0",
        MODEL_PROVIDER: "unknown"
      })
    ).toThrow(/Invalid app configuration:[\s\S]*COLLECTION_WINDOW_HOURS[\s\S]*MODEL_PROVIDER/);
  });
});
