// Item catalog shared by realtime, backend, and client. Data only — the rules
// that consume these defs live in ZoneRoom (equip/use) and inventory.ts (stacks).
// Deliberately small for the first inventory slice: one replaceable equip slot
// (the weapon) plus stackable consumables/drops that live in the bag.

import type { Rarity } from "./lootRoller.js";

/** Mirrors ClassId in @depthbreaker/protocol (sim must not depend on protocol). */
export type ItemClassId = "bruiser" | "mage" | "warden";

/** "tool" is reserved for the future mining-pick tier system (not used yet). */
export type ItemKind = "weapon" | "potion" | "food" | "junk" | "resource" | "tool";

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  rarity: Rarity;
  /** Max per bag slot. 1 for weapons; consumables/junk stack. */
  stackSize: number;
  /** Weapons: flat bonus folded into basic-attack raw damage. */
  attack?: number;
  /** Potions/food: fraction of maxHp restored (fed to applyHeal). */
  healFraction?: number;
  /** Weapons: classes allowed to equip. Undefined = any class. */
  classIds?: ItemClassId[];
  /** Gold the market charges the player. Absent = not sold by vendors. */
  buyValue?: number;
  /** Gold the market pays the player. Absent = unsellable. Always < buyValue. */
  sellValue?: number;
}

export const ITEMS: Record<string, ItemDef> = {
  // Starter weapons — attack 0 so the current combat baseline is unchanged.
  iron_sword: {
    id: "iron_sword",
    name: "Iron Sword",
    kind: "weapon",
    rarity: "common",
    stackSize: 1,
    attack: 0,
    classIds: ["bruiser", "warden"],
    buyValue: 25,
    sellValue: 6,
  },
  ash_staff: {
    id: "ash_staff",
    name: "Ash Staff",
    kind: "weapon",
    rarity: "common",
    stackSize: 1,
    attack: 0,
    classIds: ["mage", "warden"],
    buyValue: 25,
    sellValue: 6,
  },
  // Upgrade weapons — these are what make equipping matter.
  // dwarven_axe / war_hammer are themed for the POLYGON Dungeon Realms pack
  // (its weapon set is axes/maces/hammers) so models map 1:1 on art import.
  dwarven_axe: {
    id: "dwarven_axe",
    name: "Dwarven Axe",
    kind: "weapon",
    rarity: "uncommon",
    stackSize: 1,
    attack: 3,
    classIds: ["bruiser", "warden"],
    buyValue: 60,
    sellValue: 15,
  },
  war_hammer: {
    id: "war_hammer",
    name: "War Hammer",
    kind: "weapon",
    rarity: "rare",
    stackSize: 1,
    attack: 8,
    classIds: ["bruiser"],
    buyValue: 160,
    sellValue: 40,
  },
  ember_blade: {
    id: "ember_blade",
    name: "Ember Blade",
    kind: "weapon",
    rarity: "rare",
    stackSize: 1,
    attack: 6,
    classIds: ["bruiser", "warden"],
    buyValue: 130,
    sellValue: 32,
  },
  storm_staff: {
    id: "storm_staff",
    name: "Storm Staff",
    kind: "weapon",
    rarity: "rare",
    stackSize: 1,
    attack: 6,
    classIds: ["mage", "warden"],
    buyValue: 130,
    sellValue: 32,
  },
  oathbreaker: {
    id: "oathbreaker",
    name: "Oathbreaker",
    kind: "weapon",
    rarity: "epic",
    stackSize: 1,
    attack: 12,
    classIds: ["bruiser"],
    sellValue: 90,
  },
  starcaller: {
    id: "starcaller",
    name: "Starcaller",
    kind: "weapon",
    rarity: "legendary",
    stackSize: 1,
    attack: 16,
    classIds: ["mage", "warden"],
    sellValue: 150,
  },
  // Consumables + drops that live in the bag.
  health_potion: {
    id: "health_potion",
    name: "Health Potion",
    kind: "potion",
    rarity: "common",
    stackSize: 20,
    healFraction: 0.35,
    buyValue: 20,
    sellValue: 5,
  },
  bread: {
    id: "bread",
    name: "Bread",
    kind: "food",
    rarity: "common",
    stackSize: 20,
    healFraction: 0.2,
    buyValue: 10,
    sellValue: 2,
  },
  cracked_charm: {
    id: "cracked_charm",
    name: "Cracked Charm",
    kind: "junk",
    rarity: "common",
    stackSize: 20,
    sellValue: 2,
  },
  // Gathered resources (mining) — sold at the market for gold.
  iron_ore: {
    id: "iron_ore",
    name: "Iron Ore",
    kind: "resource",
    rarity: "common",
    stackSize: 20,
    sellValue: 6,
  },
  crystal_shard: {
    id: "crystal_shard",
    name: "Crystal Shard",
    kind: "resource",
    rarity: "uncommon",
    stackSize: 20,
    sellValue: 18,
  },
  // Raw fish (fishing) — a resource; carries a sellValue so cooking has a real
  // opportunity cost vs. selling, and it auto-appears in the Market Sell tab.
  raw_minnow: {
    id: "raw_minnow",
    name: "Raw Minnow",
    kind: "resource",
    rarity: "common",
    stackSize: 20,
    sellValue: 3,
  },
  raw_cavefish: {
    id: "raw_cavefish",
    name: "Raw Cavefish",
    kind: "resource",
    rarity: "uncommon",
    stackSize: 20,
    sellValue: 9,
  },
  raw_gilded_bass: {
    id: "raw_gilded_bass",
    name: "Raw Gilded Bass",
    kind: "resource",
    rarity: "rare",
    stackSize: 20,
    sellValue: 22,
  },
  // Cooked food (cooking) — heals more than bread (0.2); no buyValue, so the
  // only way to get it is to cook it. Shares the potion cooldown when eaten.
  cooked_minnow: {
    id: "cooked_minnow",
    name: "Cooked Minnow",
    kind: "food",
    rarity: "common",
    stackSize: 20,
    healFraction: 0.3,
    sellValue: 6,
  },
  cooked_cavefish: {
    id: "cooked_cavefish",
    name: "Cooked Cavefish",
    kind: "food",
    rarity: "uncommon",
    stackSize: 20,
    healFraction: 0.45,
    sellValue: 15,
  },
  grilled_bass: {
    id: "grilled_bass",
    name: "Grilled Bass",
    kind: "food",
    rarity: "rare",
    stackSize: 20,
    healFraction: 0.6,
    sellValue: 34,
  },
};

export function itemDef(id: string): ItemDef | undefined {
  return ITEMS[id];
}

/** Flat attack bonus for an equipped weapon id (0 if unknown / non-weapon). */
export function weaponAttack(id: string): number {
  return ITEMS[id]?.attack ?? 0;
}

/** Max stack for an item id (1 when unknown, so unknown ids never merge). */
export function stackSizeOf(id: string): number {
  return ITEMS[id]?.stackSize ?? 1;
}

/** Whether a class may equip a weapon id. */
export function canEquipWeapon(classId: ItemClassId, id: string): boolean {
  const def = ITEMS[id];
  if (!def || def.kind !== "weapon") return false;
  return !def.classIds || def.classIds.includes(classId);
}
