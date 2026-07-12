import { describe, expect, it } from "vitest";
import { SPINNER_PRIZES, SPINNER_SEGMENTS, FREE_SPIN_COOLDOWN_SECONDS, spinPrizeAt } from "../spinner.js";
import { itemDef } from "../items.js";

describe("spinner prize table", () => {
  it("has 20 segments with exactly one gold jackpot (Kintara odds ~1/20)", () => {
    expect(SPINNER_SEGMENTS).toBe(20);
    expect(SPINNER_PRIZES.filter((p) => p.kind === "gold")).toHaveLength(1);
  });

  it("every item prize references a real item; every prize has a positive count", () => {
    for (const p of SPINNER_PRIZES) {
      expect(p.count).toBeGreaterThan(0);
      if (p.kind === "item") expect(itemDef(p.itemId)).toBeDefined();
      else expect(p.itemId).toBe("gold");
    }
  });

  it("spinPrizeAt wraps the index into range", () => {
    expect(spinPrizeAt(0)).toEqual(SPINNER_PRIZES[0]);
    expect(spinPrizeAt(SPINNER_SEGMENTS)).toEqual(SPINNER_PRIZES[0]);
    expect(spinPrizeAt(SPINNER_SEGMENTS + 3)).toEqual(SPINNER_PRIZES[3]);
    expect(spinPrizeAt(-1)).toEqual(SPINNER_PRIZES[SPINNER_SEGMENTS - 1]);
  });

  it("free-spin cooldown is 24h", () => {
    expect(FREE_SPIN_COOLDOWN_SECONDS).toBe(86400);
  });
});
