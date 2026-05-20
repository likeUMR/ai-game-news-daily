import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";

loadEnvFiles();

const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY ?? process.env.LLM_TOKEN ?? process.env.OPENAI_API_KEY;
const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL ?? process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const model = process.env.OPENAI_COMPATIBLE_MODEL ?? process.env.LLM_MODEL ?? "gpt-4o-mini";

if (!apiKey) {
  throw new Error("OPENAI_COMPATIBLE_API_KEY, LLM_TOKEN, or OPENAI_API_KEY is required for the LLM smoke test.");
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);

try {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a concise API smoke-test assistant." },
        { role: "user", content: "Reply with exactly: relay-ok" }
      ],
      temperature: 0
    }),
    signal: controller.signal
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`LLM smoke test failed with HTTP ${response.status}: ${redactSecret(bodyText, apiKey).slice(0, 500)}`);
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch (error) {
    throw new Error(`LLM smoke test returned malformed JSON: ${redactSecret(bodyText, apiKey).slice(0, 500)}`, { cause: error });
  }
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("LLM smoke test returned an empty assistant message.");
  }

  console.log(`LLM smoke test passed using model ${model} at ${baseUrl}.`);
  console.log(`Assistant reply: ${content.trim().slice(0, 120)}`);
} finally {
  clearTimeout(timeout);
}

function redactSecret(value, secret) {
  if (!secret) {
    return value;
  }
  return value.split(secret).join("[REDACTED]");
}

function loadEnvFiles(appRoot = process.cwd()) {
  const fileEnv = {};
  for (const filename of [".env", ".env.local"]) {
    const path = resolve(appRoot, filename);
    if (existsSync(path)) {
      Object.assign(fileEnv, parseDotenv(readFileSync(path)));
    }
  }
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
