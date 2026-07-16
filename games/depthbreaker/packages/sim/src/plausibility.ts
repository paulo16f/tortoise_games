// Run-report plausibility bounds (GAME_MATH_SPEC.md §7).
//
// The backend does NOT re-simulate runs; the zone server is the runtime
// authority. These bounds cap what a run-finish report may claim, so a leaked
// ZONE_SHARED_SECRET or a zone-server bug cannot mint unbounded progression.
// Tuning constants, not gameplay math — revisit alongside content tuning.
//
// Economy v2: the depth system is removed — the COLISEUM TIER a run reached is
// the progression axis (the wire/DB field keeps the legacy name `depthReached`
// until the rebrand rename). Tier 0 = never fought the champion.

/** Highest XP a single run can plausibly award having reached coliseum `tier`. */
export function maxXpForRun(tier: number): number {
  return 8000 + 4000 * Math.max(0, tier);
}

/** Highest meta-currency a single run can plausibly award at coliseum `tier`.
 *  Kill gold is near-zero in Economy v2 (kills pay materials); this headroom
 *  covers boss bounties + NPC-sale-free direct grants only. */
export function maxCurrencyForRun(tier: number): number {
  return 300 + 100 * Math.max(0, tier);
}

export const MAX_PLAUSIBLE_TIER = 100;

/**
 * Server-enforced per-account daily gold earn cap, summed across ALL grant
 * sources in the wallet ledger (run finishes, admin credits). Self-capped
 * sources (dailies ≤ ~280 boosted, spinner ≤ 120) are ledgered but exempt
 * from the check. The anti-abuse floor for any future token payout.
 */
export const DAILY_EARN_CAP = 5000;
