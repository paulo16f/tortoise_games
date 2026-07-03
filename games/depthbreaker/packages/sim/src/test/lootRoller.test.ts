import { describe, expect, it } from "vitest";
import { DeterministicRng, deriveStreamSeed, RngStream } from "../rng.js";
import { rollLoot, type LootTable, type RolledItem } from "../lootRoller.js";
import { loadVector } from "./helpers/vectors.js";

interface LootVectors {
  table: LootTable;
  sequences: { runSeed: number; rolls: (RolledItem | null)[] }[];
}

const vectors = loadVector<LootVectors>("loot_rolls.json");

describe("Loot roller (GAME_MATH_SPEC §5)", () => {
  it("replays frozen roll sequences exactly", () => {
    for (const { runSeed, rolls } of vectors.sequences) {
      const rng = new DeterministicRng(deriveStreamSeed(runSeed, RngStream.Loot));
      for (const expected of rolls) {
        expect(rollLoot(rng, vectors.table)).toEqual(expected);
      }
    }
  });

  it("downgrades a rarity with no items without consuming RNG", () => {
    // legendary-only weight forces the downgrade path on every drop; the
    // reference table has no legendary items, so drops must land on epic.
    const table: LootTable = {
      ...vectors.table,
      dropChance: 1,
      rarityWeights: [{ rarity: "legendary", weight: 1 }],
    };
    const rng = new DeterministicRng(1);
    const item = rollLoot(rng, table);
    expect(item?.rarity).toBe("epic");
  });

  it("respects dropChance = 0 and empty item lists", () => {
    const rng = new DeterministicRng(3);
    expect(rollLoot(rng, { ...vectors.table, dropChance: 0 })).toBeNull();
    expect(rollLoot(rng, { ...vectors.table, dropChance: 1, items: [] })).toBeNull();
  });

  it("rolled stats stay within declared inclusive ranges", () => {
    const rng = new DeterministicRng(deriveStreamSeed(777, RngStream.Loot));
    for (let i = 0; i < 500; i++) {
      const item = rollLoot(rng, { ...vectors.table, dropChance: 1 });
      expect(item).not.toBeNull();
      const template = vectors.table.items.find((t) => t.id === item!.baseItemId)!;
      for (const range of template.statRanges) {
        const value = item!.stats[range.stat]!;
        expect(value).toBeGreaterThanOrEqual(range.min);
        expect(value).toBeLessThanOrEqual(range.max);
      }
    }
  });

  it("rarity distribution roughly follows weights (loose tolerance)", () => {
    const rng = new DeterministicRng(deriveStreamSeed(42424242, RngStream.Loot));
    const counts: Record<string, number> = {};
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      const item = rollLoot(rng, { ...vectors.table, dropChance: 1 });
      counts[item!.rarity] = (counts[item!.rarity] ?? 0) + 1;
    }
    // legendary weight (1%) downgrades onto epic (4%) -> expect ~5% epic.
    expect(counts.common! / n).toBeGreaterThan(0.55);
    expect(counts.common! / n).toBeLessThan(0.65);
    expect(counts.epic! / n).toBeGreaterThan(0.035);
    expect(counts.epic! / n).toBeLessThan(0.065);
    expect(counts.legendary).toBeUndefined();
  });
});
