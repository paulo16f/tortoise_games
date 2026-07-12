// Market + gathering constants shared by the zone server (validation) and the
// client (UI). Prices live on the item defs in @depthbreaker/sim — this is
// only WHICH items the stall sells and the interaction ranges.

/** Item ids the market stall sells (must each have a buyValue on their def). */
export const MARKET_STOCK: readonly string[] = [
  "health_potion",
  "bread",
  "iron_sword",
  "ash_staff",
  "dwarven_axe",
  "ember_blade",
  "war_hammer",
  "storm_staff",
];

/** Max distance from the stall for buy/sell to be accepted. */
export const MARKET_RANGE = 6;

/** Max distance from a resource node for gathering to start. */
export const GATHER_RANGE = 3;

/** Gather cast duration — shared so the client cast bar matches the server. */
export const GATHER_CAST_SECONDS = 1.4;

/**
 * Town fountain: a safe heal pad at the player spawn. Any player standing
 * within FOUNTAIN_RADIUS regenerates FOUNTAIN_HEAL_PER_SECOND HP. Shared so the
 * client can draw the pad at the same footprint the server heals over.
 */
export const FOUNTAIN_RADIUS = 4;
export const FOUNTAIN_HEAL_PER_SECOND = 14;

/**
 * Persistent stash caps. Canonical values — the backend duplicates them in
 * routes/internal.ts (it doesn't depend on this package); keep in sync.
 */
export const STASH_SLOT_CAP = 24;
export const STASH_STACK_CAP = 999;
