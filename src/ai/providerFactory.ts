import type { AppConfig } from "../config/env.js";
import { MockAIProvider } from "./mockProvider.js";
import { OpenAICompatibleProvider } from "./openAiCompatibleProvider.js";
import type { AIProvider } from "./types.js";

export function createAIProvider(config: Pick<AppConfig, "MODEL_PROVIDER"> & Partial<Pick<AppConfig, "MOCK_MODE">>, env: NodeJS.ProcessEnv = process.env): AIProvider {
  if (config.MOCK_MODE || config.MODEL_PROVIDER === "mock") {
    return new MockAIProvider();
  }

  if (config.MODEL_PROVIDER === "openai" || config.MODEL_PROVIDER === "deepseek") {
    const provider = OpenAICompatibleProvider.fromEnv(env, config.MODEL_PROVIDER);
    if (!provider) {
      throw new Error(config.MODEL_PROVIDER === "deepseek" ? "Set DEEPSEEK_API_KEY." : "Set OPENAI_COMPATIBLE_API_KEY, LLM_TOKEN or OPENAI_API_KEY for the intended provider.");
    }
    return provider;
  }

  throw new Error(`MODEL_PROVIDER=${config.MODEL_PROVIDER} is configured but no AI provider implementation is available.`);
}
