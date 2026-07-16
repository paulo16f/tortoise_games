// Item catalog shared by realtime, backend, and client. Data only — the rules
// that consume these defs live in ZoneRoom (equip/use) and inventory.ts (stacks).
// Deliberately small for the first inventory slice: one replaceable equip slot
// (the weapon) plus stackable consumables/drops that live in the bag.

import type { Rarity } from "./lootRoller.js";

/** Mirrors ClassId in @depthbreaker/protocol (sim must not depend on protocol). */
export type ItemClassId = "knight" | "reaper" | "cleric" | "necromancer";

export type ItemKind = "weapon" | "potion" | "food" | "junk" | "resource" | "tool" | "key";

/**
 * Weapon archetypes (POLYGON Dungeon Realms categories). Each type has its own
 * feel — light/fast (dagger, sword) vs heavy/slow (axe, hammer) vs ranged
 * (staff, wand, bow) — and maps to a GLB model client-side (useModel.ts).
 * Class access is gated by CLASS_WEAPON_TYPES.
 */
export type WeaponType =
  | "sword"
  | "axe"
  | "mace"
  | "hammer"
  | "dagger"
  | "spear"
  | "staff"
  | "wand"
  | "bow";

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  rarity: Rarity;
  /** Max per bag slot. 1 for weapons; consumables/junk stack. */
  stackSize: number;
  /** Weapons: archetype (feel + model + class gating). */
  weaponType?: WeaponType;
  /** Weapons: flat bonus folded into basic-attack raw damage. */
  attack?: number;
  /** Weapons: swing-speed multiplier on the class base interval (>1 = faster). Default 1. */
  attackSpeed?: number;
  /** Weapons: added to the base crit chance (0..1). Default 0. */
  critBonus?: number;
  /** Weapons: melee reach bonus added to the class attack range (units; may be negative). */
  reach?: number;
  /** Potions/food: fraction of maxHp restored (fed to applyHeal). */
  healFraction?: number;
  /** Weapons: classes allowed to equip. Undefined = derived from weaponType. */
  classIds?: ItemClassId[];
  /** Gold the market charges the player. Absent = not sold by vendors. */
  buyValue?: number;
  /** Gold the market pays the player. Absent = unsellable. Always < buyValue. */
  sellValue?: number;
  /**
   * Economy v2 durability. Tools: gathering actions before breaking. Weapons:
   * durability points — each DEATH costs DEATH_DURABILITY_COST, at 0 the item
   * breaks. Items with maxUses NEVER stack (stackSize must be 1).
   */
  maxUses?: number;
  /** Tools: which gathering family this tool enables. */
  toolKind?: "mining" | "fishing";
}

/** Durability a weapon loses when its wielder dies (see maxUses). */
export const DEATH_DURABILITY_COST = 10;

/** Max uses/durability for an item id (undefined = not a durability item). */
export function itemMaxUses(itemId: string): number | undefined {
  return ITEMS[itemId]?.maxUses;
}

/** Which weapon archetypes each class may wield. */
export const CLASS_WEAPON_TYPES: Record<ItemClassId, readonly WeaponType[]> = {
  knight: ["sword", "axe", "mace", "hammer", "spear", "dagger"],
  reaper: ["sword", "axe", "hammer", "spear"],
  cleric: ["mace", "staff"],
  necromancer: ["staff", "wand"],
};

export const ITEMS: Record<string, ItemDef> = {
  // Starter weapons — attack 0 so the melee/caster baseline is unchanged.
  // Class access derives from weaponType via CLASS_WEAPON_TYPES (no classIds).
  iron_sword: {
    id: "iron_sword",
    name: "Iron Sword",
    kind: "weapon",
    rarity: "common",
    stackSize: 1,
    weaponType: "sword",
    attack: 0,
    attackSpeed: 1,
    buyValue: 25,
    sellValue: 6,
  },
  ash_staff: {
    id: "ash_staff",
    name: "Ash Staff",
    kind: "weapon",
    rarity: "common",
    stackSize: 1,
    weaponType: "staff",
    attack: 0,
    attackSpeed: 1,
    buyValue: 25,
    sellValue: 6,
  },
  // A fast, crit-leaning off-starter for melee — light and short.
  iron_dagger: {
    id: "iron_dagger",
    name: "Iron Dagger",
    kind: "weapon",
    rarity: "common",
    stackSize: 1,
    weaponType: "dagger",
    attack: 1,
    attackSpeed: 1.4,
    critBonus: 0.08,
    reach: -0.4,
    buyValue: 30,
    sellValue: 7,
  },
  // A quick caster wand for mages who want more casts, less burst.
  apprentice_wand: {
    id: "apprentice_wand",
    name: "Apprentice Wand",
    kind: "weapon",
    rarity: "common",
    stackSize: 1,
    weaponType: "wand",
    attack: 2,
    attackSpeed: 1.15,
    buyValue: 35,
    sellValue: 8,
  },
  // Upgrade weapons — heavier types hit harder but slower; each is a distinct
  // POLYGON Dungeon Realms archetype (models map 1:1 on art import).
  dwarven_axe: {
    id: "dwarven_axe",
    name: "Dwarven Axe",
    kind: "weapon",
    rarity: "uncommon",
    stackSize: 1,
    weaponType: "axe",
    attack: 3,
    attackSpeed: 0.9,
    buyValue: 60,
    sellValue: 15,
  },
  // Long reach — poke from just outside melee range.
  war_spear: {
    id: "war_spear",
    name: "War Spear",
    kind: "weapon",
    rarity: "uncommon",
    stackSize: 1,
    weaponType: "spear",
    attack: 3,
    attackSpeed: 0.95,
    reach: 1.2,
    buyValue: 70,
    sellValue: 17,
  },
  war_hammer: {
    id: "war_hammer",
    name: "War Hammer",
    kind: "weapon",
    rarity: "rare",
    stackSize: 1,
    weaponType: "hammer",
    attack: 8,
    attackSpeed: 0.78,
    reach: 0.3,
    buyValue: 160,
    sellValue: 40,
  },
  ember_blade: {
    id: "ember_blade",
    name: "Ember Blade",
    kind: "weapon",
    rarity: "rare",
    stackSize: 1,
    weaponType: "sword",
    attack: 6,
    attackSpeed: 1.05,
    critBonus: 0.05,
    buyValue: 130,
    sellValue: 32,
  },
  storm_staff: {
    id: "storm_staff",
    name: "Storm Staff",
    kind: "weapon",
    rarity: "rare",
    stackSize: 1,
    weaponType: "staff",
    attack: 6,
    attackSpeed: 1,
    buyValue: 130,
    sellValue: 32,
  },
  oathbreaker: {
    id: "oathbreaker",
    name: "Oathbreaker",
    kind: "weapon",
    rarity: "epic",
    stackSize: 1,
    weaponType: "sword",
    attack: 12,
    attackSpeed: 0.95,
    critBonus: 0.05,
    sellValue: 90,
  },
  starcaller: {
    id: "starcaller",
    name: "Starcaller",
    kind: "weapon",
    rarity: "legendary",
    stackSize: 1,
    weaponType: "staff",
    attack: 16,
    attackSpeed: 1,
    critBonus: 0.05,
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
  // Tools (Economy v2) — gathering REQUIRES the matching tool in the bag; each
  // gather consumes 1 use and the tool breaks at 0. Starter tier sold by the
  // NPC market; better tiers come from the Forge.
  rusty_pickaxe: {
    id: "rusty_pickaxe",
    name: "Rusty Pickaxe",
    kind: "tool",
    rarity: "common",
    stackSize: 1,
    toolKind: "mining",
    maxUses: 60,
    buyValue: 15,
    sellValue: 3,
  },
  willow_rod: {
    id: "willow_rod",
    name: "Willow Rod",
    kind: "tool",
    rarity: "common",
    stackSize: 1,
    toolKind: "fishing",
    maxUses: 60,
    buyValue: 15,
    sellValue: 3,
  },
  // Forge-crafted tool tier — 200 uses, from combat materials + ore.
  iron_pickaxe: {
    id: "iron_pickaxe",
    name: "Iron Pickaxe",
    kind: "tool",
    rarity: "uncommon",
    stackSize: 1,
    toolKind: "mining",
    maxUses: 200,
    sellValue: 10,
  },
  sturdy_rod: {
    id: "sturdy_rod",
    name: "Sturdy Rod",
    kind: "tool",
    rarity: "uncommon",
    stackSize: 1,
    toolKind: "fishing",
    maxUses: 200,
    sellValue: 10,
  },
  // Coliseum trial key — consumed to summon the champion at high tiers.
  trial_key: {
    id: "trial_key",
    name: "Trial Key",
    kind: "key",
    rarity: "rare",
    stackSize: 5,
    sellValue: 60,
  },
  // Combat materials (Economy v2) — kills pay in MATERIALS, not gold. Each zone
  // family drops its own pair (common + uncommon); bosses drop the rare tier.
  // sellValue is the NPC FLOOR price; the real market is player-to-player.
  goblin_hide: {
    id: "goblin_hide",
    name: "Goblin Hide",
    kind: "resource",
    rarity: "common",
    stackSize: 20,
    sellValue: 2,
  },
  warband_totem: {
    id: "warband_totem",
    name: "Warband Totem",
    kind: "resource",
    rarity: "uncommon",
    stackSize: 20,
    sellValue: 8,
  },
  bone_shard: {
    id: "bone_shard",
    name: "Bone Shard",
    kind: "resource",
    rarity: "common",
    stackSize: 20,
    sellValue: 3,
  },
  grave_iron: {
    id: "grave_iron",
    name: "Grave Iron",
    kind: "resource",
    rarity: "uncommon",
    stackSize: 20,
    sellValue: 10,
  },
  demon_essence: {
    id: "demon_essence",
    name: "Demon Essence",
    kind: "resource",
    rarity: "common",
    stackSize: 20,
    sellValue: 5,
  },
  infernal_core: {
    id: "infernal_core",
    name: "Infernal Core",
    kind: "resource",
    rarity: "uncommon",
    stackSize: 20,
    sellValue: 18,
  },
  beast_horn: {
    id: "beast_horn",
    name: "Beast Horn",
    kind: "resource",
    rarity: "rare",
    stackSize: 20,
    sellValue: 25,
  },
  champion_sigil: {
    id: "champion_sigil",
    name: "Champion's Sigil",
    kind: "resource",
    rarity: "rare",
    stackSize: 20,
    sellValue: 50,
  },
  // Gathered resources (mining) — sold at the market for gold.
  iron_ore: {
    id: "iron_ore",
    name: "Iron Ore",
    kind: "resource",
    rarity: "common",
    stackSize: 20,
    sellValue: 4,
  },
  crystal_shard: {
    id: "crystal_shard",
    name: "Crystal Shard",
    kind: "resource",
    rarity: "uncommon",
    stackSize: 20,
    sellValue: 10,
  },
  // Raw fish (fishing) — a resource; carries a sellValue so cooking has a real
  // opportunity cost vs. selling, and it auto-appears in the Market Sell tab.
  raw_minnow: {
    id: "raw_minnow",
    name: "Raw Minnow",
    kind: "resource",
    rarity: "common",
    stackSize: 20,
    sellValue: 2,
  },
  raw_cavefish: {
    id: "raw_cavefish",
    name: "Raw Cavefish",
    kind: "resource",
    rarity: "uncommon",
    stackSize: 20,
    sellValue: 5,
  },
  raw_gilded_bass: {
    id: "raw_gilded_bass",
    name: "Raw Gilded Bass",
    kind: "resource",
    rarity: "rare",
    stackSize: 20,
    sellValue: 12,
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

// Economy v2: every weapon has durability (dying costs DEATH_DURABILITY_COST;
// at 0 the weapon breaks). Assigned by rarity so new weapons get it for free;
// an explicit per-item maxUses in the entry above still wins.
const WEAPON_DURABILITY: Record<Rarity, number> = { common: 60, uncommon: 80, rare: 100, epic: 120, legendary: 150 };
for (const def of Object.values(ITEMS)) {
  if (def.kind === "weapon" && def.maxUses === undefined) def.maxUses = WEAPON_DURABILITY[def.rarity];
}

export function itemDef(id: string): ItemDef | undefined {
  return ITEMS[id];
}

/** Flat attack bonus for an equipped weapon id (0 if unknown / non-weapon). */
export function weaponAttack(id: string): number {
  return ITEMS[id]?.attack ?? 0;
}

/** Swing-speed multiplier for an equipped weapon (1 if unknown / non-weapon). */
export function weaponAttackSpeed(id: string): number {
  return ITEMS[id]?.attackSpeed ?? 1;
}

/** Bonus crit chance for an equipped weapon (0 if none). */
export function weaponCritBonus(id: string): number {
  return ITEMS[id]?.critBonus ?? 0;
}

/** Melee reach bonus for an equipped weapon (0 if none; may be negative). */
export function weaponReach(id: string): number {
  return ITEMS[id]?.reach ?? 0;
}

/** Archetype of a weapon id (undefined if unknown / non-weapon). */
export function weaponTypeOf(id: string): WeaponType | undefined {
  return ITEMS[id]?.weaponType;
}

/** Max stack for an item id (1 when unknown, so unknown ids never merge). */
export function stackSizeOf(id: string): number {
  return ITEMS[id]?.stackSize ?? 1;
}

/**
 * Whether a class may equip a weapon id. Gated by the weapon's archetype via
 * CLASS_WEAPON_TYPES; falls back to an explicit classIds allow-list if a weapon
 * has no type, and allows any class for a typeless, listless weapon.
 */
export function canEquipWeapon(classId: ItemClassId, id: string): boolean {
  const def = ITEMS[id];
  if (!def || def.kind !== "weapon") return false;
  if (def.weaponType) return CLASS_WEAPON_TYPES[classId].includes(def.weaponType);
  return !def.classIds || def.classIds.includes(classId);
}
