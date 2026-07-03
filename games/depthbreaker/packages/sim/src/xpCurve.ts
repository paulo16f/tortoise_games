// XP curve contract (GAME_MATH_SPEC.md §2). Mirrored by XpCurve.cs.
//
// The 29-entry table is CANONICAL. It was generated once from
// floor(100 * L^2.2 + 0.5) and frozen so cross-platform pow()/rounding can
// never desync client, zone server, and backend. Do not regenerate at runtime.

export const LEVEL_CAP = 30;

/** XP_TO_NEXT[L - 1] = XP required to go from level L to L + 1, for L in 1..29. */
export const XP_TO_NEXT: readonly number[] = [
  100, 459, 1121, 2111, 3449, 5151, 7231, 9701, 12570, 15849,
  19546, 23670, 28228, 33226, 38672, 44572, 50932, 57756, 65052, 72823,
  81074, 89811, 99038, 108759, 118978, 129700, 140929, 152668, 164921,
];

/** Total XP from level 1 to reach the cap: 1,578,097. */
export const TOTAL_XP_TO_CAP = XP_TO_NEXT.reduce((a, b) => a + b, 0);

/** XP needed to advance from `level`. Returns 0 at or above the cap. */
export function xpToNext(level: number): number {
  if (level < 1) throw new RangeError(`level must be >= 1, got ${level}`);
  if (level >= LEVEL_CAP) return 0;
  return XP_TO_NEXT[level - 1]!;
}

/** Cumulative XP required to reach `level` starting from level 1 with 0 XP. */
export function totalXpForLevel(level: number): number {
  if (level < 1) throw new RangeError(`level must be >= 1, got ${level}`);
  const capped = Math.min(level, LEVEL_CAP);
  let total = 0;
  for (let l = 1; l < capped; l++) total += XP_TO_NEXT[l - 1]!;
  return total;
}

/** The level a character with `totalXp` lifetime run XP has reached (1..30). */
export function levelForTotalXp(totalXp: number): number {
  let level = 1;
  let remaining = Math.max(0, totalXp);
  while (level < LEVEL_CAP && remaining >= XP_TO_NEXT[level - 1]!) {
    remaining -= XP_TO_NEXT[level - 1]!;
    level++;
  }
  return level;
}
