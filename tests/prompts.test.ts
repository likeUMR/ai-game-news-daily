import { describe, expect, test } from "vitest";
import { getPrompt, promptTemplates, renderPrompt } from "../src/ai/prompts.js";

describe("prompt templates", () => {
  test("include the required AI and game daily news templates", () => {
    expect(Object.keys(promptTemplates).sort()).toEqual([
      "aiRelevance",
      "aiTags",
      "articleGeneration",
      "crossRelevance",
      "exclusionReasons",
      "gameRelevance",
      "gameTags",
      "groupedArticleGeneration",
      "newsValue",
      "voiceoverScriptGeneration"
    ]);
  });

  test("interpolates variables", () => {
    expect(renderPrompt("Hello {{name}}, score {{score}}.", { name: "daily", score: 90 })).toBe("Hello daily, score 90.");
  });

  test("throws when a required variable is missing", () => {
    expect(() => renderPrompt("Hello {{name}}.", {})).toThrow("Missing prompt variable: name");
  });

  test("renders article generation prompt with item variables", () => {
    const prompt = getPrompt("articleGeneration", {
      sourceUrl: "https://example.com/story",
      summary: "AI NPC tools shipped.",
      tags: "tooling, npc",
      content: "A studio shipped AI NPC tooling for games."
    });

    expect(prompt).toContain("https://example.com/story");
    expect(prompt).toContain("AI NPC tools shipped.");
    expect(prompt).not.toContain("{{");
  });

  test("renders grouped article generation prompt with commentary and summary guidance", () => {
    const prompt = getPrompt("groupedArticleGeneration", {
      groupedContext: "[]"
    });

    expect(prompt).toContain("Follow the style of these examples");
    expect(prompt).toContain("Pixel2Play");
    expect(prompt).toContain("AI以92%胜率登顶《英雄联盟》韩服");
    expect(prompt).toContain("introSummary must be a Chinese punchy点评句");
    expect(prompt).toContain("write like 小编评论");
    expect(prompt).toContain("Avoid generic AI/corporate wording");
    expect(prompt).toContain("must not repeat, translate, truncate, or paraphrase the title");
    expect(prompt).toContain("Use strictFacts as the hard factual boundary");
    expect(prompt).toContain("When the supplied context is sparse, keep the entry sparse too");
    expect(prompt).toContain("For sparse items, use this articleBody shape");
  });
});
