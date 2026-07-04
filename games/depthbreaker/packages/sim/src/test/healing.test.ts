import { describe, expect, it } from "vitest";
import { POTION_HEAL_FRACTION, POTION_COOLDOWN_SECONDS, applyHeal } from "../healing.js";
import { loadVector } from "./helpers/vectors.js";

interface HealVectors {
  potionHealFraction: number;
  cases: {
    currentHp: number;
    maxHp: number;
    fraction: number;
    newHp: number;
    effective: number;
  }[];
}

const vectors = loadVector<HealVectors>("heal_potion.json");

describe("Heal model (potion)", () => {
  it("matches frozen vectors", () => {
    expect(vectors.potionHealFraction).toBe(POTION_HEAL_FRACTION);
    for (const c of vectors.cases) {
      const got = applyHeal(c.currentHp, c.maxHp, c.fraction);
      expect(got.newHp).toBe(c.newHp);
      expect(got.effective).toBe(c.effective);
    }
  });

  it("never overheals and never exceeds maxHp", () => {
    for (const hp of [0, 1, 35, 64, 65, 99, 100]) {
      const { newHp, effective } = applyHeal(hp, 100, POTION_HEAL_FRACTION);
      expect(newHp).toBeLessThanOrEqual(100);
      expect(effective).toBe(newHp - Math.max(0, Math.min(100, hp)));
      expect(effective).toBeGreaterThanOrEqual(0);
    }
  });

  it("heals 0 at full HP", () => {
    expect(applyHeal(100, 100, POTION_HEAL_FRACTION)).toEqual({ newHp: 100, effective: 0 });
  });

  it("is monotone in fraction", () => {
    let prev = -1;
    for (const fraction of [0, 0.1, 0.35, 0.5, 1]) {
      const { effective } = applyHeal(20, 100, fraction);
      expect(effective).toBeGreaterThanOrEqual(prev);
      prev = effective;
    }
  });

  it("clamps hostile inputs", () => {
    expect(applyHeal(-50, 100, 0.35).newHp).toBe(35);
    expect(applyHeal(500, 100, 0.35)).toEqual({ newHp: 100, effective: 0 });
    expect(applyHeal(40, 100, -1)).toEqual({ newHp: 40, effective: 0 });
  });

  it("exposes a positive cooldown constant for server/HUD agreement", () => {
    expect(POTION_COOLDOWN_SECONDS).toBeGreaterThan(0);
  });
});
