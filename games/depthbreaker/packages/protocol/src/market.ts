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
