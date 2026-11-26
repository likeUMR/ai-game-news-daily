import "tsx/esm";
import { URL } from "node:url";

const { loadConfig, loadEnvFiles } = await import("../src/config/env.ts");
const { resolveModelConnection } = await import("../src/ai/modelConnection.ts");
const { OpenAICompatibleProvider } = await import("../src/ai/openAiCompatibleProvider.ts");

async function main() {
  loadEnvFiles();
  const { MODEL_PROVIDER } = loadConfig();
  const connection = resolveModelConnection(process.env, MODEL_PROVIDER);
  if (!connection) throw new Error("Missing key for the configured provider.");
  const { baseUrl, model, apiKey } = connection;
  if (connection.migratedFrom) console.log(`Configured ${connection.migratedFrom} resolves to ${model}.`);
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Model list returned HTTP ${response.status}.`);
  const models = (await response.json()).data.map((entry) => entry.id);
  console.log(`${new URL(baseUrl).origin} lists ${models.length} models. Configured model ${model} listed=${models.includes(model)}.`);
  if (!models.includes(model)) throw new Error("Configured model missing from this account's list.");
  if (process.argv.includes("--list")) return;
  const provider = new OpenAICompatibleProvider(connection);
  await provider.classifyAndFilter({
    articleTitle: "Game studio tests an AI tool",
    sourceName: "Configuration check",
    rawContent: "A game studio tested an AI-assisted translation tool on one game. This is a configuration check."
  }, { minCrossRelevanceScore: 60 });
  console.log("Production classification JSON passed schema validation.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
