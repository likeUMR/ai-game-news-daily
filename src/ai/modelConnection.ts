export interface ModelConnection {
  apiKey: string;
  baseUrl: string;
  model: string;
  migratedFrom?: string;
}

export const openAiBase = "https://api.openai.com/v1";
const deepSeekBase = "https://api.deepseek.com/v1";
const tuyouBases = new Set(["https://relay.tuyoo.com/v1", "https://taishi.tuyoo.com/v1"]);
const tuyouModel = "gemini-3.5-flash-lite";
const legacyTuyouModel = "gemini-3-flash-preview";

export function secureBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Model base URL must use HTTPS without credentials, query or fragment.");
  }
  return url.href.replace(/\/+$/, "");
}

export function resolveModelConnection(env: NodeJS.ProcessEnv, provider = "openai"): ModelConnection | null {
  if (provider === "deepseek") {
    const baseUrl = secureBaseUrl(env.DEEPSEEK_BASE_URL?.trim() || deepSeekBase);
    if (baseUrl !== deepSeekBase && baseUrl !== "https://api.deepseek.com") {
      throw new Error("DEEPSEEK_API_KEY requires the official DeepSeek endpoint.");
    }
    const apiKey = env.DEEPSEEK_API_KEY?.trim();
    return apiKey ? { apiKey, baseUrl, model: env.DEEPSEEK_MODEL?.trim() || "deepseek-flash" } : null;
  }
  if (provider !== "openai") throw new Error("Unsupported chat provider.");

  const compatibleKey = env.OPENAI_COMPATIBLE_API_KEY?.trim();
  const legacyKey = env.LLM_TOKEN?.trim();
  const compatibleBase = env.OPENAI_COMPATIBLE_BASE_URL?.trim();
  const legacyBase = env.LLM_BASE_URL?.trim();
  if (compatibleKey || legacyKey) {
    const ownBase = compatibleKey ? compatibleBase : legacyBase;
    const otherBase = compatibleKey ? legacyBase : compatibleBase;
    if (!ownBase && compatibleKey && legacyKey && compatibleKey !== legacyKey) {
      throw new Error("Each configured relay key needs its own matching base URL.");
    }
    const base = ownBase || otherBase;
    if (!base) throw new Error("Set OPENAI_COMPATIBLE_BASE_URL or LLM_BASE_URL for this relay key.");
    const baseUrl = secureBaseUrl(base);
    const host = new URL(baseUrl).hostname;
    if (["api.openai.com", "api.deepseek.com"].includes(host) && (!ownBase || !compatibleKey || compatibleKey === legacyKey)) {
      throw new Error("A relay token cannot be routed to an official API. Use the official provider's own key.");
    }
    const ownModel = compatibleKey ? env.OPENAI_COMPATIBLE_MODEL : env.LLM_MODEL;
    const aliasModel = compatibleKey ? env.LLM_MODEL : env.OPENAI_COMPATIBLE_MODEL;
    const sameRoute = !otherBase || secureBaseUrl(otherBase) === baseUrl;
    const isTuyou = tuyouBases.has(baseUrl);
    const model = ownModel?.trim() || (sameRoute && aliasModel?.trim()) || (isTuyou && tuyouModel);
    if (!model) throw new Error("Set the chat model explicitly for this compatible endpoint.");
    const connection = { apiKey: compatibleKey || legacyKey!, baseUrl, model };
    if (isTuyou && model === legacyTuyouModel) {
      return { ...connection, model: tuyouModel, migratedFrom: model };
    }
    return connection;
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = secureBaseUrl(env.OPENAI_BASE_URL?.trim() || openAiBase);
  if (baseUrl !== openAiBase || compatibleBase || legacyBase) {
    throw new Error("For a relay configure its matched key and base URL. OPENAI_API_KEY alone requires the official OpenAI endpoint.");
  }
  return { apiKey, baseUrl, model: env.OPENAI_MODEL?.trim() || "gpt-4o-mini" };
}
