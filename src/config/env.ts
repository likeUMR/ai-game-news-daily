import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";
import { z } from "zod";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return value;
}, z.boolean());

const providerSchema = z.enum(["mock", "openai", "anthropic", "google", "local"]);
const ttsProviderSchema = z.enum(["mock", "openai", "edge", "local"]);

const rawEnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  APP_ROOT: z.string().min(1).default(process.cwd()),
  MOCK_MODE: booleanFromEnv.default(true),
  OUTPUT_DIR: z.string().min(1).default("output"),
  DATA_DIR: z.string().min(1).default("data"),
  DATABASE_PATH: z.string().min(1).optional(),
  COLLECTION_WINDOW_HOURS: z.coerce.number().int().positive().max(168).default(24),
  DEDUPE_WINDOW_HOURS: z.coerce.number().int().positive().max(720).default(72),
  MODEL_PROVIDER: providerSchema.default("mock"),
  TTS_PROVIDER: ttsProviderSchema.default("mock"),
  MIN_AI_RELEVANCE_SCORE: z.coerce.number().int().min(0).max(100).default(50),
  MIN_GAME_RELEVANCE_SCORE: z.coerce.number().int().min(0).max(100).default(50),
  MIN_NEWS_VALUE_SCORE: z.coerce.number().int().min(0).max(100).default(55),
  MIN_CROSS_RELEVANCE_SCORE: z.coerce.number().int().min(0).max(100).default(60),
  DAILY_ITEM_COUNT: z.coerce.number().int().positive().max(100).default(5),
  DAILY_CATEGORY_COUNTS: z.string().default("AI x Game=5"),
  LOW_TRUST_SOURCE_WEIGHT: z.coerce.number().int().min(0).max(100).default(40),
  LOW_TRUST_HIGH_SCORE: z.coerce.number().int().min(0).max(100).default(85),
  SELECTION_FRESHNESS_HOURS: z.coerce.number().int().positive().max(720).default(72),
  VIDEO_FRAME_WIDTH: z.coerce.number().int().positive().max(7680).default(1920),
  VIDEO_FRAME_HEIGHT: z.coerce.number().int().positive().max(4320).default(1080),
  MAX_ITEMS_PER_SOURCE: z.coerce.number().int().positive().max(1000).default(50),
  MAX_ITEMS_TOTAL: z.coerce.number().int().positive().max(10000).default(500)
});

const envSchema = rawEnvSchema.transform((env) => {
  const appRoot = resolve(env.APP_ROOT);
  const dataDir = resolve(appRoot, env.DATA_DIR);
  const outputDir = resolve(appRoot, env.OUTPUT_DIR);
  const databasePath = resolve(appRoot, env.DATABASE_PATH ?? join(env.DATA_DIR, "news-daily.sqlite"));

  return {
    ...env,
    APP_ROOT: appRoot,
    DATA_DIR: dataDir,
    OUTPUT_DIR: outputDir,
    DATABASE_PATH: databasePath
  };
});

export type AppConfig = z.infer<typeof envSchema>;
export type ModelProvider = z.infer<typeof providerSchema>;
export type TtsProvider = z.infer<typeof ttsProviderSchema>;

export function loadEnvFiles(appRoot = process.cwd(), env: NodeJS.ProcessEnv = process.env): void {
  const fileEnv: Record<string, string> = {};

  for (const filename of [".env", ".env.local"]) {
    const path = resolve(appRoot, filename);
    if (!existsSync(path)) {
      continue;
    }
    Object.assign(fileEnv, parseDotenv(readFileSync(path)));
  }

  for (const [key, value] of Object.entries(fileEnv)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid app configuration:\n${details}`);
  }

  return result.data;
}
