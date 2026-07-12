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

/**
 * Server-enforced per-account daily gold earn cap, summed across ALL grant
 * sources in the wallet ledger (run finishes, admin credits). Self-capped
 * sources (dailies ≤ ~280 boosted, spinner ≤ 120) are ledgered but exempt
 * from the check. The anti-abuse floor for any future token payout.
 */
export const DAILY_EARN_CAP = 5000;
