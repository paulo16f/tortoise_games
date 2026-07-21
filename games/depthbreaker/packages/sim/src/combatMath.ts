// Damage model contract (GAME_MATH_SPEC.md §3). Mirrored by CombatMath.cs.

export const ARMOR_K_PER_LEVEL = 100;
export const MAX_DAMAGE_REDUCTION = 0.75;
export const CRIT_MULTIPLIER = 1.5;
export const GCD_SECONDS = 1.0;

/**
 * Global cooldown gate. A shared cooldown that class skills spend on cast so
 * instants can't be chained in a single frame; auto-attack and potions are
 * OFF the GCD (they run on their own timers). `gcdRemaining` counts down toward
 * 0 (= ready); tick it with `advanceTimer` (combatTimeline.ts).
 */
export function isOnGlobalCooldown(gcdRemaining: number): boolean {
  return gcdRemaining > 0;
}

/** Seconds to charge the global cooldown when a skill is cast. */
export function beginGlobalCooldown(): number {
  return GCD_SECONDS;
}

/**
 * Round half away from zero for non-negative inputs: floor(x + 0.5).
 * Specified explicitly because JS Math.round and C# Math.Round disagree on .5.
 */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/** Ratio armor: DR = armor / (armor + 100·attackerLevel), capped at 0.75. */
export function damageReduction(armor: number, attackerLevel: number): number {
  const a = Math.max(0, armor);
  const level = Math.max(1, attackerLevel);
  const dr = a / (a + ARMOR_K_PER_LEVEL * level);
  return Math.min(MAX_DAMAGE_REDUCTION, dr);
}

/** Crit multiplies raw BEFORE mitigation. A landed hit always deals >= 1. */
export function resolveDamage(
  rawDamage: number,
  targetArmor: number,
  attackerLevel: number,
  isCrit: boolean,
): number {
  const raw = isCrit ? rawDamage * CRIT_MULTIPLIER : rawDamage;
  const dr = damageReduction(targetArmor, attackerLevel);
  return Math.max(1, roundHalfUp(raw * (1 - dr)));
}
