import { describe, expect, test } from "vitest";
import { sourceRegistry, validateSourceRegistry } from "../src/config/sourceRegistry.js";

describe("sourceRegistry", () => {
  test("validates the default source registry", () => {
    const sources = validateSourceRegistry();
    const names = sources.map((source) => source.name);

    expect(sources).toHaveLength(sourceRegistry.length);
    expect(names).toEqual(
      expect.arrayContaining([
        "GameLook",
        "GameLook AI",
        "机核",
        "触乐",
        "游戏陀螺",
        "游戏茶馆",
        "游民星空",
        "游研社",
        "罗斯基",
        "3DM",
        "游戏葡萄"
      ])
    );
  });

  test("rejects malformed source records", () => {
    expect(() =>
      validateSourceRegistry([
        {
          id: "bad source id",
          name: "",
          source_group: "game_native",
          source_type: "game_media",
          priority: "urgent",
          source_weight: 101,
          suggested_frequency: "",
          collection_strategy: "crawler"
        }
      ])
    ).toThrow(/Invalid source registry/);
  });

  test("rejects duplicate source ids", () => {
    const [firstSource] = sourceRegistry;

    expect(() => validateSourceRegistry([firstSource, firstSource])).toThrow(/duplicate source id/);
  });
});
