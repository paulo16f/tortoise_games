// Token spend split — Law §2 as amended by PHASE2_TOKEN_ECONOMY.md: every
// premium token spend divides 50% burn / 50% treasury (no recycle leg — this
// design pays no game-funded token rewards, so there is nothing to recycle
// into). The P2P gold-sale fee is treasury-only (it is a fee, not a spend).
// Pure math, shared by the backend ledger writer and tests. Amounts are in
// base token units (integers) so the split never leaks dust: burn gets the
// floor, treasury gets the remainder, burn + treasury === amount always.

export const SPEND_BURN_SHARE = 0.5;

/** P2P gold-sale fee in basis points (5%) — MARKET_FEE_BPS default. */
export const GOLD_MARKET_FEE_BPS = 500;

export interface SpendSplit {
  burn: number;
  treasury: number;
}

/** Split a premium spend (integer base units) into burn + treasury. */
export function splitSpend(amount: number): SpendSplit {
  if (!Number.isFinite(amount) || amount <= 0) return { burn: 0, treasury: 0 };
  const whole = Math.floor(amount);
  const burn = Math.floor(whole * SPEND_BURN_SHARE);
  return { burn, treasury: whole - burn };
}

/** The seller's take and the treasury fee for a P2P gold sale (integer base units). */
export function splitGoldSale(amount: number): { seller: number; fee: number } {
  if (!Number.isFinite(amount) || amount <= 0) return { seller: 0, fee: 0 };
  const whole = Math.floor(amount);
  const fee = Math.floor((whole * GOLD_MARKET_FEE_BPS) / 10_000);
  return { seller: whole - fee, fee };
}
