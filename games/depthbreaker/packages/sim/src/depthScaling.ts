// Depth scaling — the "go deeper = harder fights, better pay" contract.
// Depth increments when the floor boss dies (the party "breaks depth"); every
// enemy spawned AFTER that is scaled by these multipliers, and the backend's
// per-run plausibility caps (maxXpForDepth / maxCurrencyForDepth) rise with the
// same depth, so scaled earnings stay inside the server's accepted envelope.
//
// Pure data + math (no engine imports) so the client, zone server, and tests
// all agree. Rewards deliberately outpace difficulty (+35% pay vs +20% hp per
// depth) — descending must FEEL profitable or nobody pushes the loop.

/** Depth is clamped into [0, MAX_SCALED_DEPTH] before any multiplier math. */
export const MAX_SCALED_DEPTH = 50;

/** +20% enemy max HP per depth. */
export const DEPTH_HP_PER_LEVEL = 0.2;
/** +12% enemy attack/slam damage per depth (gentler than HP — fights get longer before they get lethal). */
export const DEPTH_DAMAGE_PER_LEVEL = 0.12;
/** +25% kill XP per depth. */
export const DEPTH_XP_PER_LEVEL = 0.25;
/** +35% kill gold per depth — the core Kintara-style "deeper pays better" hook. */
export const DEPTH_CURRENCY_PER_LEVEL = 0.35;

function clampDepth(depth: number): number {
  if (!Number.isFinite(depth)) return 0;
  return Math.max(0, Math.min(MAX_SCALED_DEPTH, Math.floor(depth)));
}

export function depthHpMult(depth: number): number {
  return 1 + DEPTH_HP_PER_LEVEL * clampDepth(depth);
}

export function depthDamageMult(depth: number): number {
  return 1 + DEPTH_DAMAGE_PER_LEVEL * clampDepth(depth);
}

export function depthXpMult(depth: number): number {
  return 1 + DEPTH_XP_PER_LEVEL * clampDepth(depth);
}

export function depthCurrencyMult(depth: number): number {
  return 1 + DEPTH_CURRENCY_PER_LEVEL * clampDepth(depth);
}

/** Scaled kill XP (rounded, never below the base value at depth 0). */
export function scaledXp(baseXp: number, depth: number): number {
  return Math.round(baseXp * depthXpMult(depth));
}

/** Scaled kill gold (rounded, never below the base value at depth 0). */
export function scaledCurrency(baseCurrency: number, depth: number): number {
  return Math.round(baseCurrency * depthCurrencyMult(depth));
}
