// Live loot tables consumed by ZoneRoom on enemy death, keyed by enemy rank.
// Shaped for the existing rollLoot() contract (lootRoller.ts) so the RNG order
// stays spec-compliant. These are SEPARATE from generateVectors.ts's frozen
// referenceTable — never fold these into the vector generator.

import type { LootTable } from "./lootRoller.js";

/** Matches EnemyRank in realtime/src/enemies.ts (kept as a local string union). */
export type LootRank = "normal" | "elite" | "boss";

// MVP items carry no rolled statRanges — drops are fungible catalog ids for now.
export const LOOT_TABLES: Record<LootRank, LootTable> = {
  normal: {
    dropChance: 0.35,
    rarityWeights: [
      { rarity: "common", weight: 92 },
      { rarity: "rare", weight: 8 },
    ],
    items: [
      { id: "health_potion", rarity: "common", statRanges: [] },
      { id: "bread", rarity: "common", statRanges: [] },
      { id: "cracked_charm", rarity: "common", statRanges: [] },
      { id: "ember_blade", rarity: "rare", statRanges: [] },
      { id: "storm_staff", rarity: "rare", statRanges: [] },
    ],
  },
  elite: {
    dropChance: 0.6,
    rarityWeights: [
      { rarity: "common", weight: 60 },
      { rarity: "rare", weight: 35 },
      { rarity: "epic", weight: 5 },
    ],
    items: [
      { id: "health_potion", rarity: "common", statRanges: [] },
      { id: "bread", rarity: "common", statRanges: [] },
      { id: "ember_blade", rarity: "rare", statRanges: [] },
      { id: "storm_staff", rarity: "rare", statRanges: [] },
      { id: "oathbreaker", rarity: "epic", statRanges: [] },
    ],
  },
  boss: {
    dropChance: 1,
    rarityWeights: [
      { rarity: "rare", weight: 60 },
      { rarity: "epic", weight: 32 },
      { rarity: "legendary", weight: 8 },
    ],
    items: [
      { id: "ember_blade", rarity: "rare", statRanges: [] },
      { id: "storm_staff", rarity: "rare", statRanges: [] },
      { id: "oathbreaker", rarity: "epic", statRanges: [] },
      { id: "starcaller", rarity: "legendary", statRanges: [] },
    ],
  },
};
