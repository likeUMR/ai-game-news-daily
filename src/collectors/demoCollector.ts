import type { SourceDefinition } from "../config/sourceRegistry.js";
import type { CollectionResult, Collector, RawCollectedItem } from "./types.js";

export class DemoCollector implements Collector {
  readonly name = "demo";

  async collect(_sources: SourceDefinition[], now = new Date("2026-05-19T00:00:00.000Z")): Promise<CollectionResult> {
    const collectedAt = now.toISOString();
    const items: RawCollectedItem[] = [
      {
        title: "AI NPC tooling reaches live game operations",
        url: "https://example.com/demo/ai-npc-live-ops",
        source_name: "Demo AI Game Wire",
        source_type: "ai_game_media",
        published_at: "2026-05-18T10:00:00.000Z",
        collected_at: collectedAt,
        author: "Demo Desk",
        excerpt: "A studio uses AI-assisted NPC tooling for narrative testing and live operations.",
        raw_content: "A studio uses AI-assisted NPC tooling for narrative testing and live operations across a multiplayer game.",
        metadata: { collector: this.name, seed: true, tags: ["ai", "npc", "live-ops"] }
      },
      {
        title: "Generative asset review enters game QA",
        url: "https://example.com/demo/generative-asset-review",
        source_name: "Demo AI Game Wire",
        source_type: "ai_game_media",
        published_at: "2026-05-18T12:00:00.000Z",
        collected_at: collectedAt,
        author: "Demo Desk",
        excerpt: "Game QA teams test an AI review workflow for generated art and localization assets.",
        raw_content: "Game QA teams test an AI review workflow for generated art, localization assets, and compliance checks.",
        metadata: { collector: this.name, seed: true, tags: ["ai", "qa", "assets"] }
      }
    ];

    return { items, failures: [] };
  }
}
