// Threat/aggro contract (GAME_MATH_SPEC.md §4). Mirrored by ThreatTable.cs.
//
// Damage adds 1.0 threat per point. Healing adds 0.5 per effective point
// (the CALLER splits healing threat across enemies in combat with the healer
// and excludes overheal). A new target is only adopted past 110% of the
// current target's threat when the candidate is in melee range, 130% beyond.

export const DAMAGE_THREAT_PER_POINT = 1.0;
export const HEAL_THREAT_PER_POINT = 0.5;
export const MELEE_SWAP_THRESHOLD = 1.1;
export const RANGED_SWAP_THRESHOLD = 1.3;

export class ThreatTable {
  private threat = new Map<string, number>();

  addDamage(entityId: string, amount: number): void {
    this.add(entityId, amount * DAMAGE_THREAT_PER_POINT);
  }

  /** `amount` must already be this enemy's share of effective (non-over) healing. */
  addHeal(entityId: string, amount: number): void {
    this.add(entityId, amount * HEAL_THREAT_PER_POINT);
  }

  private add(entityId: string, threat: number): void {
    if (threat <= 0) return;
    this.threat.set(entityId, (this.threat.get(entityId) ?? 0) + threat);
  }

  getThreat(entityId: string): number {
    return this.threat.get(entityId) ?? 0;
  }

  /**
   * Force `entityId` to the top of the table by a clear margin, so the next
   * selectTarget() adopts it past any swap threshold (Knight taunt). Sets its
   * threat to 1.5× the current highest (+1 so it wins even from an empty table).
   */
  forceTarget(entityId: string): void {
    let max = 0;
    for (const value of this.threat.values()) if (value > max) max = value;
    this.threat.set(entityId, max * 1.5 + 1);
  }

  remove(entityId: string): void {
    this.threat.delete(entityId);
  }

  clear(): void {
    this.threat.clear();
  }

  get size(): number {
    return this.threat.size;
  }

  /**
   * Pick the entity to attack. Candidates are considered in descending threat
   * (ties broken by ascending entityId for determinism). Among candidates that
   * clear their swap threshold vs the current target, the highest-threat one
   * wins; otherwise the current target is kept.
   */
  selectTarget(
    currentTargetId: string | null,
    isInMeleeRange: (entityId: string) => boolean,
  ): string | null {
    if (this.threat.size === 0) return null;

    const sorted = [...this.threat.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    );
    const top = sorted[0]!;

    const currentThreat =
      currentTargetId !== null ? this.threat.get(currentTargetId) : undefined;
    if (currentTargetId === null || currentThreat === undefined) return top[0];

    for (const [id, threat] of sorted) {
      if (id === currentTargetId) break; // nothing above current cleared a threshold
      const threshold = isInMeleeRange(id)
        ? MELEE_SWAP_THRESHOLD
        : RANGED_SWAP_THRESHOLD;
      if (threat >= currentThreat * threshold) return id;
    }
    return currentTargetId;
  }
}
