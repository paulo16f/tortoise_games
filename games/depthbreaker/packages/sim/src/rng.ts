// Deterministic RNG shared-math contract.
// Reference implementation of shared-spec/GAME_MATH_SPEC.md §1; mirrored by
// unity/Assets/Scripts/Shared/DeterministicRng.cs. Both must satisfy
// shared-spec/vectors/rng.json bit-for-bit.

/** Named substreams so one system's rolls can never shift another's. */
export const RngStream = {
  Layout: 1,
  Loot: 2,
  Spawns: 3,
} as const;

/** splitmix32. State and outputs are uint32. */
export class DeterministicRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  nextUint32(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0;
    let z = this.state;
    z ^= z >>> 16;
    z = Math.imul(z, 0x21f0aaad) >>> 0;
    z ^= z >>> 15;
    z = Math.imul(z, 0x735a2d97) >>> 0;
    z ^= z >>> 15;
    return z >>> 0;
  }

  /** Uniform in [0, 1). Exactly nextUint32() / 2^32. */
  nextFloat01(): number {
    return this.nextUint32() / 4294967296;
  }

  /**
   * Uniform integer in [minInclusive, maxExclusive) via modulo.
   * Modulo bias is accepted and part of the contract (spans are tiny vs 2^32).
   */
  nextRange(minInclusive: number, maxExclusive: number): number {
    const span = maxExclusive - minInclusive;
    if (span <= 0) throw new RangeError("nextRange requires maxExclusive > minInclusive");
    return minInclusive + (this.nextUint32() % span);
  }
}

/** Derive an independent substream seed from a run seed and a stream id. */
export function deriveStreamSeed(seed32: number, streamId: number): number {
  const mixed = ((seed32 >>> 0) ^ (Math.imul(streamId, 0x9e3779b9) >>> 0)) >>> 0;
  return new DeterministicRng(mixed).nextUint32();
}
