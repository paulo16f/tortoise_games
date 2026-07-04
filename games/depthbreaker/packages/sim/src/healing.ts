// Healing model contract (GAME_MATH_SPEC.md §3 rounding rules apply).

import { roundHalfUp } from "./combatMath.js";

export const POTION_HEAL_FRACTION = 0.35;
export const POTION_COOLDOWN_SECONDS = 12;

export interface HealResult {
  newHp: number;
  /** Effective (non-overheal) healing — this is what feeds heal threat. */
  effective: number;
}

/**
 * Apply a fraction-of-max-HP heal. Overheal is clamped: `effective` never
 * exceeds the missing HP, so callers can pass it straight to ThreatTable.addHeal.
 */
export function applyHeal(currentHp: number, maxHp: number, fraction: number): HealResult {
  const max = Math.max(0, maxHp);
  const hp = Math.min(max, Math.max(0, currentHp));
  const amount = roundHalfUp(max * Math.max(0, fraction));
  const effective = Math.min(max - hp, amount);
  return { newHp: hp + effective, effective };
}
