import { describe, expect, it } from "vitest";
import {
  STREAK_BONUS_CAP_DAYS,
  advanceStreak,
  prevDateKeyUTC,
  streakGold,
  streakGoldMult,
} from "../dailyQuests.js";

describe("daily streaks", () => {
  it("prevDateKeyUTC steps back one UTC day, across month/year boundaries", () => {
    expect(prevDateKeyUTC("2026-07-12")).toBe("2026-07-11");
    expect(prevDateKeyUTC("2026-03-01")).toBe("2026-02-28");
    expect(prevDateKeyUTC("2026-01-01")).toBe("2025-12-31");
  });

  it("advanceStreak: first ever claim starts at 1", () => {
    expect(advanceStreak("", "2026-07-12", 0)).toBe(1);
  });

  it("advanceStreak: consecutive day increments, same day holds, gap resets", () => {
    expect(advanceStreak("2026-07-11", "2026-07-12", 3)).toBe(4);
    expect(advanceStreak("2026-07-12", "2026-07-12", 4)).toBe(4);
    expect(advanceStreak("2026-07-09", "2026-07-12", 9)).toBe(1);
  });

  it("gold bonus is +10%/day capped at +50% — MAX_DAILY_GOLD stays bounded", () => {
    expect(streakGoldMult(1)).toBe(1);
    expect(streakGoldMult(3)).toBeCloseTo(1.2);
    expect(streakGoldMult(STREAK_BONUS_CAP_DAYS)).toBeCloseTo(1.5);
    expect(streakGoldMult(100)).toBeCloseTo(1.5);
    expect(streakGold(60, 1)).toBe(60);
    expect(streakGold(60, 4)).toBe(78);
    expect(streakGold(70, 999)).toBe(105);
  });
});
