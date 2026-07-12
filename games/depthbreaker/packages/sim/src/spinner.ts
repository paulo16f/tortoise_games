// Spinner wheel prize table (Kintara model: 20 segments, ~1/20 wins gold, the
// rest award resources). Pure data + a pick-by-index helper so the roll is
// testable; the backend supplies the random index. Gold prizes credit the
// wallet; item prizes go to the stash.

export interface SpinPrize {
  /** "gold" credits the wallet; anything else is a stash item id. */
  kind: "gold" | "item";
  itemId: string; // "gold" for gold, else the item id
  count: number;
}

/** 20 wheel segments. One gold jackpot; the rest are ore/shard bundles. */
export const SPINNER_PRIZES: readonly SpinPrize[] = [
  { kind: "gold", itemId: "gold", count: 50 },
  { kind: "item", itemId: "iron_ore", count: 3 },
  { kind: "item", itemId: "iron_ore", count: 1 },
  { kind: "item", itemId: "iron_ore", count: 2 },
  { kind: "item", itemId: "crystal_shard", count: 1 },
  { kind: "item", itemId: "iron_ore", count: 5 },
  { kind: "item", itemId: "iron_ore", count: 1 },
  { kind: "item", itemId: "iron_ore", count: 2 },
  { kind: "item", itemId: "crystal_shard", count: 2 },
  { kind: "item", itemId: "iron_ore", count: 4 },
  { kind: "item", itemId: "iron_ore", count: 1 },
  { kind: "item", itemId: "iron_ore", count: 3 },
  { kind: "item", itemId: "bread", count: 2 },
  { kind: "item", itemId: "iron_ore", count: 2 },
  { kind: "item", itemId: "iron_ore", count: 1 },
  { kind: "item", itemId: "crystal_shard", count: 1 },
  { kind: "item", itemId: "iron_ore", count: 3 },
  { kind: "item", itemId: "health_potion", count: 1 },
  { kind: "item", itemId: "iron_ore", count: 2 },
  { kind: "item", itemId: "iron_ore", count: 1 },
] as const;

export const SPINNER_SEGMENTS = SPINNER_PRIZES.length;

/** Free spin cooldown (Kintara: one free spin per 24h). */
export const FREE_SPIN_COOLDOWN_SECONDS = 24 * 60 * 60;

/** The prize on a given wheel segment (0..SPINNER_SEGMENTS-1). */
export function spinPrizeAt(index: number): SpinPrize {
  const i = ((index % SPINNER_SEGMENTS) + SPINNER_SEGMENTS) % SPINNER_SEGMENTS;
  return SPINNER_PRIZES[i]!;
}
