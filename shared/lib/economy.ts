// Universal 5-law seasonal pool economy engine.
// Usage: const engine = createEconomyEngine({ seasonPoolInitial: 100_000, seasonDurationSeconds: 30*24*3600, gatePower: 10 })

export interface EconomyConfig {
  seasonPoolInitial: number;
  seasonDurationSeconds: number;
  gatePower: number;
}

export interface PlayerEconomyState {
  power: number;
  tokens: number;
  lastSettledAt: number;
}

export interface BurnSplitResult {
  burned: number;
  toPool: number;
  treasury: number;
}

export function createEconomyEngine(config: EconomyConfig) {
  const EMISSION_RATE = config.seasonPoolInitial / config.seasonDurationSeconds;

  let _totalPower = 0;
  let _seasonEmitted = 0;
  let _seasonPool = config.seasonPoolInitial;

  const globalTotalPower = () => _totalPower;
  const addGlobalPower = (delta: number) => { _totalPower += delta; };
  const poolRemaining = () => Math.max(0, _seasonPool - _seasonEmitted);

  // Call at the TOP of every action handler. Accrues earnings since last call.
  function settle(state: PlayerEconomyState): void {
    const now = Date.now();
    const elapsed = (now - (state.lastSettledAt ?? now)) / 1000;
    state.lastSettledAt = now;
    if (elapsed < 1 || _totalPower === 0 || state.power < config.gatePower) return;
    const earned = Math.min(EMISSION_RATE * elapsed * (state.power / _totalPower), poolRemaining());
    if (earned <= 0) return;
    state.tokens = (state.tokens ?? 0) + earned;
    _seasonEmitted += earned;
  }

  // Apply to every in-game token spend. 40% burned, 40% recycled to pool, 20% treasury.
  function burnSplit(amount: number): BurnSplitResult {
    const burned   = amount * 0.4;
    const toPool   = amount * 0.4;
    const treasury = amount * 0.2;
    _seasonPool   += toPool;
    _seasonEmitted = Math.max(0, _seasonEmitted - toPool);
    return { burned, toPool, treasury };
  }

  function resetSeason(newPool?: number): void {
    _seasonPool    = newPool ?? config.seasonPoolInitial;
    _seasonEmitted = 0;
  }

  function poolStats() {
    return { seasonPool: _seasonPool, seasonEmitted: _seasonEmitted, totalPower: _totalPower, poolRemaining: poolRemaining() };
  }

  return { settle, burnSplit, resetSeason, poolStats, globalTotalPower, addGlobalPower, poolRemaining, EMISSION_RATE };
}
