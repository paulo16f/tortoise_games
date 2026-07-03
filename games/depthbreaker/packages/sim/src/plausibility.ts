// Run-report plausibility bounds (GAME_MATH_SPEC.md §7).
//
// The backend does NOT re-simulate runs; the zone server is the runtime
// authority. These bounds cap what a run-finish report may claim, so a leaked
// ZONE_SHARED_SECRET or a zone-server bug cannot mint unbounded progression.
// Tuning constants, not gameplay math — revisit alongside content tuning.

/** Highest XP a single run can plausibly award having reached `depth`. */
export function maxXpForDepth(depth: number): number {
  return 5000 * Math.max(1, depth);
}

/** Highest meta-currency a single run can plausibly award at `depth`. */
export function maxCurrencyForDepth(depth: number): number {
  return 100 + 60 * Math.max(0, depth);
}

export const MAX_PLAUSIBLE_DEPTH = 50;
