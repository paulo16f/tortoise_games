// Loot roll contract (GAME_MATH_SPEC.md §5). Mirrored by LootRoller.cs.
// RNG call order is part of the contract — see rollLoot() comments.

import { DeterministicRng } from "./rng.js";

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

export interface StatRange {
  stat: string;
  min: number;
  max: number; // inclusive
}

export interface LootItemTemplate {
  id: string;
  rarity: Rarity;
  statRanges: StatRange[];
}

export interface RarityWeight {
  rarity: Rarity;
  weight: number;
}

export interface LootTable {
  /** Probability in [0,1] that a kill drops anything. */
  dropChance: number;
  /** Walked in declared order when rolling rarity. */
  rarityWeights: RarityWeight[];
  items: LootItemTemplate[];
}

export interface RolledItem {
  baseItemId: string;
  rarity: Rarity;
  stats: Record<string, number>;
}

/**
 * Roll a drop. RNG consumption order (normative):
 *   1. one nextFloat01() for the drop check (>= dropChance -> null, no more rolls);
 *   2. one nextUint32() % totalWeight for rarity, walking rarityWeights in order;
 *   3. if the rolled rarity has no items, downgrade toward common until a rarity
 *      with items is found (no RNG consumed); if none exists -> null;
 *   4. one nextUint32() % count to pick among that rarity's items in declared order;
 *   5. one nextRange(min, max + 1) per statRange, in declared order.
 */
export function rollLoot(rng: DeterministicRng, table: LootTable): RolledItem | null {
  if (rng.nextFloat01() >= table.dropChance) return null;

  const totalWeight = table.rarityWeights.reduce((a, w) => a + w.weight, 0);
  if (totalWeight <= 0) return null;
  let roll = rng.nextUint32() % totalWeight;
  let rolledRarity: Rarity = table.rarityWeights[table.rarityWeights.length - 1]!.rarity;
  for (const { rarity, weight } of table.rarityWeights) {
    if (roll < weight) {
      rolledRarity = rarity;
      break;
    }
    roll -= weight;
  }

  let candidates: LootItemTemplate[] = [];
  let rarityIndex = RARITIES.indexOf(rolledRarity);
  while (rarityIndex >= 0) {
    const rarity = RARITIES[rarityIndex]!;
    candidates = table.items.filter((i) => i.rarity === rarity);
    if (candidates.length > 0) break;
    rarityIndex--;
  }
  if (candidates.length === 0) return null;

  const item = candidates[rng.nextUint32() % candidates.length]!;
  const stats: Record<string, number> = {};
  for (const range of item.statRanges) {
    stats[range.stat] = rng.nextRange(range.min, range.max + 1);
  }
  return { baseItemId: item.id, rarity: item.rarity, stats };
}
