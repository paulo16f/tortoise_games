// Forge recipes — the smithing hub of the Economy v2 treadmill. Combat drops
// zone materials; the forge turns them (plus a GOLD FEE — a real sink) into
// weapons, tools and coliseum trial keys, and repairs worn durability gear.
// Pure data + lookups, mirroring cooking.ts: the server (ZoneRoom.craftForge)
// is the only executor; the client renders the panel from this table.

import { itemDef, itemMaxUses } from "./items.js";

export interface ForgeRecipe {
  id: string;
  /** Item id produced. */
  output: string;
  outputCount: number;
  /** Materials consumed from the bag. */
  inputs: { itemId: string; count: number }[];
  /** Gold fee (wallet debit) — the forge's sink component. */
  goldCost: number;
}

export const FORGE_RECIPES: readonly ForgeRecipe[] = [
  // Tools — better tiers than the market's starter pair (200 uses vs 60).
  { id: "forge_iron_pickaxe", output: "iron_pickaxe", outputCount: 1, goldCost: 10, inputs: [{ itemId: "iron_ore", count: 4 }, { itemId: "goblin_hide", count: 2 }] },
  { id: "forge_sturdy_rod", output: "sturdy_rod", outputCount: 1, goldCost: 10, inputs: [{ itemId: "bone_shard", count: 4 }, { itemId: "goblin_hide", count: 2 }] },
  // Weapons — each tier keyed to its zone's materials, so hunting there feeds
  // the craft. Gold fees scale as sinks.
  { id: "forge_dwarven_axe", output: "dwarven_axe", outputCount: 1, goldCost: 20, inputs: [{ itemId: "iron_ore", count: 6 }, { itemId: "goblin_hide", count: 4 }] },
  { id: "forge_ember_blade", output: "ember_blade", outputCount: 1, goldCost: 60, inputs: [{ itemId: "grave_iron", count: 4 }, { itemId: "crystal_shard", count: 2 }] },
  { id: "forge_war_hammer", output: "war_hammer", outputCount: 1, goldCost: 80, inputs: [{ itemId: "grave_iron", count: 6 }, { itemId: "beast_horn", count: 2 }] },
  { id: "forge_oathbreaker", output: "oathbreaker", outputCount: 1, goldCost: 150, inputs: [{ itemId: "infernal_core", count: 4 }, { itemId: "beast_horn", count: 2 }] },
  { id: "forge_starcaller", output: "starcaller", outputCount: 1, goldCost: 300, inputs: [{ itemId: "infernal_core", count: 6 }, { itemId: "champion_sigil", count: 1 }, { itemId: "beast_horn", count: 4 }] },
  // Coliseum trial key — content-as-consumable (tiers beyond the free band
  // consume one). Champion materials feed the next challenge.
  { id: "forge_trial_key", output: "trial_key", outputCount: 1, goldCost: 100, inputs: [{ itemId: "champion_sigil", count: 1 }, { itemId: "beast_horn", count: 3 }] },
];

export function forgeRecipe(id: string): ForgeRecipe | undefined {
  return FORGE_RECIPES.find((r) => r.id === id);
}

/** Sentinel recipe id: repair the EQUIPPED weapon to full durability. */
export const REPAIR_WEAPON_ID = "repair_weapon";

/** Gold cost to fully repair a durability item (weapons/tools): half its
 *  market sellValue, floor 5 — cheap enough to always be worth it vs losing
 *  the item, expensive enough to matter as a sink. */
export function repairCost(itemId: string): number | undefined {
  if (itemMaxUses(itemId) === undefined) return undefined;
  const sell = itemDef(itemId)?.sellValue ?? 10;
  return Math.max(5, Math.round(sell * 0.5));
}
