import { describe, expect, it } from "vitest";
import {
  CRIT_MULTIPLIER,
  GCD_SECONDS,
  MAX_DAMAGE_REDUCTION,
  beginGlobalCooldown,
  damageReduction,
  isOnGlobalCooldown,
  resolveDamage,
  roundHalfUp,
} from "../combatMath.js";
import { loadVector } from "./helpers/vectors.js";

interface DamageVectors {
  cases: {
    armor: number;
    attackerLevel: number;
    raw: number;
    isCrit: boolean;
    damageReduction: number;
    finalDamage: number;
  }[];
}

const vectors = loadVector<DamageVectors>("damage_reduction.json");

describe("Damage model (GAME_MATH_SPEC §3)", () => {
  it("matches frozen vectors", () => {
    for (const c of vectors.cases) {
      expect(damageReduction(c.armor, c.attackerLevel)).toBe(c.damageReduction);
      expect(resolveDamage(c.raw, c.armor, c.attackerLevel, c.isCrit)).toBe(c.finalDamage);
    }
  });

  it("caps reduction at 75% no matter the armor", () => {
    expect(damageReduction(10_000_000, 1)).toBe(MAX_DAMAGE_REDUCTION);
    // At level 1, K=100: 300 armor is exactly the 75% cap boundary.
    expect(damageReduction(300, 1)).toBe(0.75);
    expect(damageReduction(299, 1)).toBeLessThan(0.75);
  });

  it("never deals less than 1 and never increases with more armor", () => {
    expect(resolveDamage(1, 100000, 1, false)).toBe(1);
    let prev = Number.POSITIVE_INFINITY;
    for (const armor of [0, 50, 100, 200, 400, 800]) {
      const dmg = resolveDamage(100, armor, 10, false);
      expect(dmg).toBeLessThanOrEqual(prev);
      prev = dmg;
    }
  });

  it("crit multiplies raw before mitigation; rounding is half-up", () => {
    expect(resolveDamage(10, 0, 1, true)).toBe(10 * CRIT_MULTIPLIER);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(2.4999999)).toBe(2);
  });

  it("clamps hostile inputs: negative armor as 0, level floor of 1", () => {
    expect(damageReduction(-500, 5)).toBe(0);
    expect(damageReduction(100, 0)).toBe(damageReduction(100, 1));
  });
});

describe("Global cooldown gate", () => {
  it("is ready at exactly 0 and blocked while any time remains", () => {
    expect(isOnGlobalCooldown(0)).toBe(false);
    expect(isOnGlobalCooldown(-0.1)).toBe(false);
    expect(isOnGlobalCooldown(0.001)).toBe(true);
    expect(isOnGlobalCooldown(GCD_SECONDS)).toBe(true);
  });

  it("charges the cooldown to GCD_SECONDS on cast", () => {
    expect(beginGlobalCooldown()).toBe(GCD_SECONDS);
  });
});
