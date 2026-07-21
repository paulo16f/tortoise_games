// Shared item-presentation helpers (colors + labels), so the bag grid, the loot
// toast, and the HUD weapon slot render every item identically off the catalog.

import { itemDef } from "@depthbreaker/sim";

export const RARITY_COLOR: Record<string, string> = {
  common: "#9ca3af",
  uncommon: "#22c55e",
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

/** Border/text color for a rarity, falling back to a neutral tone. */
export function rarityColor(rarity: string): string {
  return RARITY_COLOR[rarity] ?? "rgba(255,255,255,0.4)";
}

/** Full display name for an item id, falling back to the raw id. */
export function itemName(itemId: string): string {
  return itemDef(itemId)?.name ?? itemId;
}

/** Up-to-3-letter badge for an item, derived from its name's word initials. */
export function itemInitials(itemId: string): string {
  const def = itemDef(itemId);
  if (!def) return itemId.slice(0, 3).toUpperCase();
  return def.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}
