import type { AppConfig } from "../config/env.js";
import { MockAIProvider } from "./mockProvider.js";
import { OpenAICompatibleProvider } from "./openAiCompatibleProvider.js";
import type { AIProvider } from "./types.js";

export function createAIProvider(config: Pick<AppConfig, "MODEL_PROVIDER">, env: NodeJS.ProcessEnv = process.env): AIProvider {
  if (config.MODEL_PROVIDER === "mock") {
    return new MockAIProvider();
  }

  if (config.MODEL_PROVIDER === "openai") {
    const provider = OpenAICompatibleProvider.fromEnv(env);
    if (!provider) {
      throw new Error("MODEL_PROVIDER=openai requires OPENAI_COMPATIBLE_API_KEY or OPENAI_API_KEY.");
    }
    return provider;
  }

  throw new Error(`MODEL_PROVIDER=${config.MODEL_PROVIDER} is configured but no AI provider implementation is available.`);
}
