import { describe, expect, it } from "vitest";
import {
  LEVEL_CAP,
  TOTAL_XP_TO_CAP,
  XP_TO_NEXT,
  levelForTotalXp,
  totalXpForLevel,
  xpToNext,
} from "../xpCurve.js";
import { loadVector } from "./helpers/vectors.js";

interface XpVectors {
  levelCap: number;
  xpToNext: number[];
  totalXpToCap: number;
  totalXpForLevel: { level: number; totalXp: number }[];
  levelForTotalXp: { xp: number; level: number }[];
}

const vectors = loadVector<XpVectors>("xp_curve.json");

describe("XP curve (GAME_MATH_SPEC §2)", () => {
  it("table matches the frozen canonical vector", () => {
    expect([...XP_TO_NEXT]).toEqual(vectors.xpToNext);
    expect(LEVEL_CAP).toBe(vectors.levelCap);
    expect(TOTAL_XP_TO_CAP).toBe(vectors.totalXpToCap);
  });

  it("matches frozen totalXpForLevel and levelForTotalXp cases", () => {
    for (const { level, totalXp } of vectors.totalXpForLevel) {
      expect(totalXpForLevel(level)).toBe(totalXp);
    }
    for (const { xp, level } of vectors.levelForTotalXp) {
      expect(levelForTotalXp(xp)).toBe(level);
    }
  });

  it("is strictly increasing and caps at 30", () => {
    for (let l = 2; l <= 29; l++) {
      expect(xpToNext(l)).toBeGreaterThan(xpToNext(l - 1));
    }
    expect(xpToNext(30)).toBe(0);
    expect(xpToNext(31)).toBe(0);
    expect(levelForTotalXp(Number.MAX_SAFE_INTEGER)).toBe(30);
  });

  it("roundtrips: reaching exactly totalXpForLevel(L) means level L", () => {
    for (let l = 1; l <= 30; l++) {
      const total = totalXpForLevel(l);
      expect(levelForTotalXp(total)).toBe(l);
      if (l < 30) expect(levelForTotalXp(total - 1)).toBe(Math.max(1, l - 1));
    }
  });

  it("rejects levels below 1 and clamps negative xp", () => {
    expect(() => xpToNext(0)).toThrow(RangeError);
    expect(levelForTotalXp(-500)).toBe(1);
  });
});
