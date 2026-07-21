// Market + gathering constants shared by the zone server (validation) and the
// client (UI). Prices live on the item defs in @depthbreaker/sim — this is
// only WHICH items the stall sells and the interaction ranges.

/** Item ids the market stall sells (must each have a buyValue on their def). */
export const MARKET_STOCK: readonly string[] = [
  "health_potion",
  "bread",
  "rusty_pickaxe",
  "willow_rod",
  "iron_sword",
  "ash_staff",
  "iron_dagger",
  "apprentice_wand",
  "dwarven_axe",
  "war_spear",
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

/** Fishing cast duration — longer than mining so fishing reads as its own action. */
export const FISH_CAST_SECONDS = 2.2;

/** Max distance from the cooking station for a craft to be accepted. */
export const COOK_RANGE = 6;

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
