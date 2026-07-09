import { DeterministicRng } from "./rng.js";

export const ARPG_RARITIES = ["common", "rare", "legendary", "mythic"] as const;
export type ArpgRarity = (typeof ARPG_RARITIES)[number];
export type ArpgClassId = "bruiser" | "mage" | "warden";
export type ArpgItemKind = "weapon" | "consumable" | "bag" | "boost" | "junk";
export type ArpgVendorId = "market" | "blacksmith" | "apothecary" | "premium";
export type ArpgEnemyRank = "common" | "rare" | "elite" | "boss";

export interface ArpgItemDef {
  id: string;
  name: string;
  kind: ArpgItemKind;
  rarity: ArpgRarity;
  price: number;
  sellValue: number;
  attack?: number;
  heal?: number;
  bagSlots?: number;
  stackSize?: number;
  classIds?: ArpgClassId[];
}

export interface ArpgInventorySlot {
  itemId: string;
  count: number;
}

export interface ArpgInventoryState {
  gold: number;
  slots: ArpgInventorySlot[];
  equipment: {
    weapon: string | null;
  };
  baseCapacity: number;
  bonusCapacity: number;
}

export interface ArpgVendorDef {
  id: ArpgVendorId;
  name: string;
  items: string[];
}

export interface ArpgLootTable {
  dropChance: number;
  goldMin: number;
  goldMax: number;
  rarityWeights: Record<ArpgRarity, number>;
  items: string[];
}

export interface ArpgLootReward {
  gold: number;
  itemId: string | null;
}

export const ARPG_ITEM_DEFS: Record<string, ArpgItemDef> = {
  iron_sword: {
    id: "iron_sword",
    name: "Iron Sword",
    kind: "weapon",
    rarity: "common",
    price: 55,
    sellValue: 14,
    attack: 4,
    classIds: ["bruiser", "warden"],
  },
  ash_staff: {
    id: "ash_staff",
    name: "Ash Staff",
    kind: "weapon",
    rarity: "common",
    price: 55,
    sellValue: 14,
    attack: 4,
    classIds: ["mage", "warden"],
  },
  ember_blade: {
    id: "ember_blade",
    name: "Ember Blade",
    kind: "weapon",
    rarity: "rare",
    price: 180,
    sellValue: 45,
    attack: 9,
    classIds: ["bruiser", "warden"],
  },
  storm_staff: {
    id: "storm_staff",
    name: "Storm Staff",
    kind: "weapon",
    rarity: "rare",
    price: 180,
    sellValue: 45,
    attack: 9,
    classIds: ["mage", "warden"],
  },
  oathbreaker: {
    id: "oathbreaker",
    name: "Oathbreaker",
    kind: "weapon",
    rarity: "legendary",
    price: 900,
    sellValue: 220,
    attack: 18,
    classIds: ["bruiser"],
  },
  starcaller: {
    id: "starcaller",
    name: "Starcaller",
    kind: "weapon",
    rarity: "mythic",
    price: 1800,
    sellValue: 450,
    attack: 28,
    classIds: ["mage", "warden"],
  },
  health_potion: {
    id: "health_potion",
    name: "Health Potion",
    kind: "consumable",
    rarity: "common",
    price: 18,
    sellValue: 5,
    heal: 45,
    stackSize: 20,
  },
  small_bag: {
    id: "small_bag",
    name: "Small Bag",
    kind: "bag",
    rarity: "common",
    price: 120,
    sellValue: 30,
    bagSlots: 6,
  },
  adventurer_bag: {
    id: "adventurer_bag",
    name: "Adventurer Bag",
    kind: "bag",
    rarity: "rare",
    price: 360,
    sellValue: 90,
    bagSlots: 12,
  },
  xp_boost_placeholder: {
    id: "xp_boost_placeholder",
    name: "XP Boost",
    kind: "boost",
    rarity: "rare",
    price: 9999,
    sellValue: 0,
    stackSize: 5,
  },
  cracked_charm: {
    id: "cracked_charm",
    name: "Cracked Charm",
    kind: "junk",
    rarity: "common",
    price: 0,
    sellValue: 8,
    stackSize: 20,
  },
};

export const ARPG_VENDOR_DEFS: Record<ArpgVendorId, ArpgVendorDef> = {
  market: {
    id: "market",
    name: "Market",
    items: ["health_potion", "small_bag", "adventurer_bag"],
  },
  blacksmith: {
    id: "blacksmith",
    name: "Blacksmith",
    items: ["iron_sword", "ash_staff", "ember_blade", "storm_staff"],
  },
  apothecary: {
    id: "apothecary",
    name: "Apothecary",
    items: ["health_potion"],
  },
  premium: {
    id: "premium",
    name: "Boost Vendor",
    items: ["xp_boost_placeholder"],
  },
};

export const ARPG_LOOT_TABLES: Record<ArpgEnemyRank, ArpgLootTable> = {
  common: {
    dropChance: 0.35,
    goldMin: 3,
    goldMax: 8,
    rarityWeights: { common: 92, rare: 8, legendary: 0, mythic: 0 },
    items: ["cracked_charm", "health_potion", "iron_sword", "ash_staff"],
  },
  rare: {
    dropChance: 0.55,
    goldMin: 8,
    goldMax: 16,
    rarityWeights: { common: 70, rare: 28, legendary: 2, mythic: 0 },
    items: ["health_potion", "ember_blade", "storm_staff", "small_bag"],
  },
  elite: {
    dropChance: 0.75,
    goldMin: 18,
    goldMax: 34,
    rarityWeights: { common: 48, rare: 42, legendary: 9, mythic: 1 },
    items: ["ember_blade", "storm_staff", "adventurer_bag", "oathbreaker"],
  },
  boss: {
    dropChance: 1,
    goldMin: 80,
    goldMax: 140,
    rarityWeights: { common: 0, rare: 65, legendary: 28, mythic: 7 },
    items: ["ember_blade", "storm_staff", "oathbreaker", "starcaller", "adventurer_bag"],
  },
};

export function createArpgInventory(classId: ArpgClassId): ArpgInventoryState {
  const weapon = classId === "mage" ? "ash_staff" : "iron_sword";
  return {
    gold: 70,
    slots: [{ itemId: "health_potion", count: 3 }],
    equipment: { weapon },
    baseCapacity: 16,
    bonusCapacity: 0,
  };
}

export function arpgCapacity(inventory: ArpgInventoryState): number {
  return inventory.baseCapacity + inventory.bonusCapacity;
}

export function getItemDef(itemId: string): ArpgItemDef {
  const def = ARPG_ITEM_DEFS[itemId];
  if (!def) throw new Error(`Unknown item: ${itemId}`);
  return def;
}

export function addArpgItem(inventory: ArpgInventoryState, itemId: string, count = 1): boolean {
  const def = getItemDef(itemId);
  const stackSize = def.stackSize ?? 1;
  let remaining = count;
  if (stackSize > 1) {
    for (const slot of inventory.slots) {
      if (slot.itemId !== itemId || slot.count >= stackSize) continue;
      const moved = Math.min(remaining, stackSize - slot.count);
      slot.count += moved;
      remaining -= moved;
      if (remaining <= 0) return true;
    }
  }
  while (remaining > 0) {
    if (inventory.slots.length >= arpgCapacity(inventory)) return false;
    const moved = Math.min(remaining, stackSize);
    inventory.slots.push({ itemId, count: moved });
    remaining -= moved;
  }
  return true;
}

export function removeArpgItem(inventory: ArpgInventoryState, itemId: string, count = 1): boolean {
  let remaining = count;
  for (let i = inventory.slots.length - 1; i >= 0; i--) {
    const slot = inventory.slots[i]!;
    if (slot.itemId !== itemId) continue;
    const removed = Math.min(remaining, slot.count);
    slot.count -= removed;
    remaining -= removed;
    if (slot.count <= 0) inventory.slots.splice(i, 1);
    if (remaining <= 0) return true;
  }
  return false;
}

export function buyArpgItem(inventory: ArpgInventoryState, vendorId: ArpgVendorId, itemId: string): boolean {
  const vendor = ARPG_VENDOR_DEFS[vendorId];
  const def = getItemDef(itemId);
  if (!vendor.items.includes(itemId) || inventory.gold < def.price) return false;
  inventory.gold -= def.price;
  if (addArpgItem(inventory, itemId, 1)) return true;
  inventory.gold += def.price;
  return false;
}

export function sellArpgItem(inventory: ArpgInventoryState, itemId: string): boolean {
  const def = getItemDef(itemId);
  if (!removeArpgItem(inventory, itemId, 1)) return false;
  inventory.gold += def.sellValue;
  return true;
}

export function equipArpgItem(inventory: ArpgInventoryState, classId: ArpgClassId, itemId: string): boolean {
  const def = getItemDef(itemId);
  if (def.kind === "bag") {
    if (!removeArpgItem(inventory, itemId, 1)) return false;
    inventory.bonusCapacity += def.bagSlots ?? 0;
    return true;
  }
  if (def.kind !== "weapon" || (def.classIds && !def.classIds.includes(classId))) return false;
  if (!removeArpgItem(inventory, itemId, 1)) return false;
  const previous = inventory.equipment.weapon;
  inventory.equipment.weapon = itemId;
  if (previous) addArpgItem(inventory, previous, 1);
  return true;
}

export function useArpgPotion(inventory: ArpgInventoryState, hp: number, maxHp: number): { ok: boolean; hp: number } {
  const def = getItemDef("health_potion");
  if (!removeArpgItem(inventory, "health_potion", 1)) return { ok: false, hp };
  return { ok: true, hp: Math.min(maxHp, hp + (def.heal ?? 0)) };
}

export function arpgWeaponAttack(inventory: ArpgInventoryState): number {
  const weapon = inventory.equipment.weapon ? ARPG_ITEM_DEFS[inventory.equipment.weapon] : undefined;
  return weapon?.attack ?? 0;
}

export function rollArpgLoot(rng: DeterministicRng, rank: ArpgEnemyRank): ArpgLootReward {
  const table = ARPG_LOOT_TABLES[rank];
  const gold = rng.nextRange(table.goldMin, table.goldMax + 1);
  if (rng.nextFloat01() >= table.dropChance) return { gold, itemId: null };
  const rarity = rollArpgRarity(rng, table.rarityWeights);
  const candidates = table.items.filter((itemId) => ARPG_ITEM_DEFS[itemId]?.rarity === rarity);
  const fallback = candidates.length > 0 ? candidates : table.items;
  return { gold, itemId: fallback[rng.nextUint32() % fallback.length] ?? null };
}

function rollArpgRarity(rng: DeterministicRng, weights: Record<ArpgRarity, number>): ArpgRarity {
  const total = ARPG_RARITIES.reduce((sum, rarity) => sum + weights[rarity], 0);
  if (total <= 0) return "common";
  let roll = rng.nextUint32() % total;
  for (const rarity of ARPG_RARITIES) {
    if (roll < weights[rarity]) return rarity;
    roll -= weights[rarity];
  }
  return "common";
}
