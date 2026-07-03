import { describe, expect, it } from "vitest";
import { DeterministicRng, deriveStreamSeed } from "../rng.js";
import { loadVector } from "./helpers/vectors.js";

interface RngVectors {
  sequences: { seed: number; first8: number[] }[];
  streamSeeds: { seed: number; streamId: number; derived: number }[];
  ranges: number[];
}

const vectors = loadVector<RngVectors>("rng.json");

describe("DeterministicRng (GAME_MATH_SPEC §1)", () => {
  it("matches frozen sequences", () => {
    for (const { seed, first8 } of vectors.sequences) {
      const rng = new DeterministicRng(seed);
      expect(Array.from({ length: 8 }, () => rng.nextUint32())).toEqual(first8);
    }
  });

  it("derives frozen stream seeds", () => {
    for (const { seed, streamId, derived } of vectors.streamSeeds) {
      expect(deriveStreamSeed(seed, streamId)).toBe(derived);
    }
  });

  it("matches frozen nextRange outputs", () => {
    const rng = new DeterministicRng(7);
    expect(Array.from({ length: 6 }, () => rng.nextRange(1, 11))).toEqual(vectors.ranges);
  });

  it("outputs stay in uint32 range and floats in [0,1)", () => {
    const rng = new DeterministicRng(0xffffffff);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextUint32();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(v)).toBe(true);
    }
    const frng = new DeterministicRng(5);
    for (let i = 0; i < 1000; i++) {
      const f = frng.nextFloat01();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("same seed yields identical streams; different streams diverge", () => {
    const a = new DeterministicRng(99);
    const b = new DeterministicRng(99);
    for (let i = 0; i < 100; i++) expect(a.nextUint32()).toBe(b.nextUint32());
    expect(deriveStreamSeed(99, 1)).not.toBe(deriveStreamSeed(99, 2));
  });
});
