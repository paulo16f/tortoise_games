import { describe, expect, it } from "vitest";
import {
  DAILY_QUEST_CATALOG,
  DAILY_QUEST_COUNT,
  MAX_DAILY_GOLD,
  dailyQuestDef,
  dailyQuestsFor,
  dateKeyUTC,
} from "../dailyQuests.js";

describe("daily quests", () => {
  it("returns a deterministic, distinct set per date key", () => {
    const a = dailyQuestsFor("2026-07-10");
    const b = dailyQuestsFor("2026-07-10");
    expect(a).toEqual(b); // deterministic
    expect(a).toHaveLength(DAILY_QUEST_COUNT);
    expect(new Set(a.map((q) => q.id)).size).toBe(a.length); // distinct
    for (const q of a) expect(DAILY_QUEST_CATALOG).toContainEqual(q);
  });

  it("rotates across dates", () => {
    const days = ["2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14"].map((d) =>
      dailyQuestsFor(d).map((q) => q.id).join(","),
    );
    // Not all five days produce the identical trio (would signal a broken seed).
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it("keeps a day's total gold within the documented cap", () => {
    for (const d of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
      const total = dailyQuestsFor(d).reduce((s, q) => s + q.goldReward, 0);
      expect(total).toBeLessThanOrEqual(MAX_DAILY_GOLD);
      expect(total).toBeGreaterThan(0);
    }
  });

  it("catalog integrity: ids unique, positive rewards/targets, kind valid", () => {
    const ids = DAILY_QUEST_CATALOG.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of DAILY_QUEST_CATALOG) {
      expect(["gather", "kill", "depth"]).toContain(q.kind);
      expect(q.target).toBeGreaterThan(0);
      expect(q.goldReward).toBeGreaterThan(0);
      expect(dailyQuestDef(q.id)).toEqual(q);
    }
  });

  it("dateKeyUTC formats YYYY-MM-DD in UTC", () => {
    expect(dateKeyUTC(new Date("2026-07-10T23:59:00Z"))).toBe("2026-07-10");
    expect(dateKeyUTC(new Date("2026-07-11T00:01:00Z"))).toBe("2026-07-11");
  });
});
