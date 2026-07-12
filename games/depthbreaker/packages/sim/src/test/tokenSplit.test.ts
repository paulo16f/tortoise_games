import { describe, expect, it } from "vitest";
import { GOLD_MARKET_FEE_BPS, splitGoldSale, splitSpend } from "../tokenSplit.js";

describe("token spend split (Law §2, 50/50 as amended)", () => {
  it("splits evenly and never leaks dust", () => {
    for (const amount of [1, 2, 3, 100, 101, 999_999_999, 123_456_789]) {
      const { burn, treasury } = splitSpend(amount);
      expect(burn + treasury).toBe(Math.floor(amount));
      expect(Math.abs(burn - treasury)).toBeLessThanOrEqual(1);
    }
  });

  it("rejects garbage", () => {
    expect(splitSpend(0)).toEqual({ burn: 0, treasury: 0 });
    expect(splitSpend(-5)).toEqual({ burn: 0, treasury: 0 });
    expect(splitSpend(Number.NaN)).toEqual({ burn: 0, treasury: 0 });
  });
});

describe("gold-sale 95/5 split", () => {
  it("fee is 5% floored; seller + fee always equals the sale", () => {
    expect(GOLD_MARKET_FEE_BPS).toBe(500);
    for (const amount of [1, 19, 20, 100, 12345, 1_000_000]) {
      const { seller, fee } = splitGoldSale(amount);
      expect(seller + fee).toBe(amount);
      expect(fee).toBe(Math.floor(amount * 0.05));
    }
  });
});
