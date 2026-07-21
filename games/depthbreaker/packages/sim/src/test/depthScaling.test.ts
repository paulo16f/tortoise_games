import { describe, expect, it } from "vitest";
import {
  MAX_SCALED_DEPTH,
  depthCurrencyMult,
  depthDamageMult,
  depthHpMult,
  depthXpMult,
  scaledCurrency,
  scaledXp,
} from "../depthScaling.js";

describe("depth scaling", () => {
  it("depth 0 is identity — no multiplier applies at the surface", () => {
    expect(depthHpMult(0)).toBe(1);
    expect(depthDamageMult(0)).toBe(1);
    expect(depthXpMult(0)).toBe(1);
    expect(depthCurrencyMult(0)).toBe(1);
    expect(scaledXp(140, 0)).toBe(140);
    expect(scaledCurrency(18, 0)).toBe(18);
  });

  it("multipliers grow linearly and monotonically with depth", () => {
    for (let d = 1; d <= 10; d++) {
      expect(depthHpMult(d)).toBeGreaterThan(depthHpMult(d - 1));
      expect(depthCurrencyMult(d)).toBeGreaterThan(depthCurrencyMult(d - 1));
    }
    expect(depthHpMult(5)).toBeCloseTo(2.0);
    expect(depthCurrencyMult(2)).toBeCloseTo(1.7);
  });

  it("rewards outpace difficulty — descending is profitable per hp of enemy", () => {
    for (let d = 1; d <= MAX_SCALED_DEPTH; d++) {
      expect(depthCurrencyMult(d)).toBeGreaterThan(depthHpMult(d));
      expect(depthXpMult(d)).toBeGreaterThan(depthDamageMult(d));
    }
  });

  it("scaled kill gold stays inside the backend plausibility cap shape", () => {
    // maxCurrencyForDepth(d) = 100 + 60d (backend plausibility.ts). A full
    // clear's boss gold (80 base) scaled by depth must never exceed the cap
    // by itself — the envelope stays sane as both rise.
    for (let d = 0; d <= 20; d++) {
      expect(scaledCurrency(80, d)).toBeLessThanOrEqual(100 + 60 * d);
    }
  });

  it("clamps garbage input: negative, fractional, huge, NaN", () => {
    expect(depthHpMult(-3)).toBe(1);
    expect(depthHpMult(2.9)).toBe(depthHpMult(2));
    expect(depthHpMult(9999)).toBe(depthHpMult(MAX_SCALED_DEPTH));
    expect(depthHpMult(Number.NaN)).toBe(1);
  });
});
