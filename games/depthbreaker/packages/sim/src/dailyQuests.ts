// Daily quests — the game's main GOLD faucet (gather/kill/coliseum objectives
// that pay gold + XP and reset daily). Pure and deterministic: the
// three active quests for a given UTC date are picked from the catalog by a
// DeterministicRng seeded from the date string, so every server agrees on
// "today's quests" without coordination and a client can preview them.
//
// Rewards are bounded (see MAX_DAILY_GOLD) to stay within the wallet-credit
// caps and the Phase 2 economy's faucet accounting.

import { DeterministicRng } from "./rng.js";

export type DailyQuestKind = "gather" | "kill" | "coliseum" | "cook";

export interface DailyQuestDef {
  id: string;
  kind: DailyQuestKind;
  /** Player-facing objective text. */
  label: string;
  /** Count to reach (ore mined, mobs killed, or depth to reach). */
  target: number;
  /** For gather: resource item id. For kill: enemy defId (or "" = any). */
  subject: string;
  goldReward: number;
  xpReward: number;
}

/** Catalog of possible daily quests. Deterministically sampled per day. */
export const DAILY_QUEST_CATALOG: readonly DailyQuestDef[] = [
  { id: "mine_iron", kind: "gather", label: "Mine 5 iron ore", target: 5, subject: "iron_ore", goldReward: 40, xpReward: 120 },
  { id: "mine_crystal", kind: "gather", label: "Mine 3 crystal shards", target: 3, subject: "crystal_shard", goldReward: 60, xpReward: 160 },
  { id: "slay_grunts", kind: "kill", label: "Slay 8 grunts", target: 8, subject: "grunt", goldReward: 50, xpReward: 200 },
  { id: "slay_any", kind: "kill", label: "Defeat 12 enemies", target: 12, subject: "", goldReward: 55, xpReward: 220 },
  { id: "slay_elites", kind: "kill", label: "Slay 3 elite grunts", target: 3, subject: "elite_grunt", goldReward: 70, xpReward: 260 },
  { id: "slay_champion", kind: "coliseum", label: "Slay the Coliseum champion", target: 1, subject: "", goldReward: 60, xpReward: 150 },
  { id: "catch_minnows", kind: "gather", label: "Catch 5 minnows", target: 5, subject: "raw_minnow", goldReward: 40, xpReward: 120 },
  { id: "cook_meals", kind: "cook", label: "Cook 3 meals", target: 3, subject: "", goldReward: 55, xpReward: 200 },
] as const;

/** How many quests are active per day. */
export const DAILY_QUEST_COUNT = 3;

/** Upper bound on gold from a full day's quests (for wallet-cap accounting). */
export const MAX_DAILY_GOLD = DAILY_QUEST_CATALOG.slice()
  .sort((a, b) => b.goldReward - a.goldReward)
  .slice(0, DAILY_QUEST_COUNT)
  .reduce((sum, q) => sum + q.goldReward, 0);

/** UTC date key "YYYY-MM-DD" — the day boundary for quest rotation. */
export function dateKeyUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function seedFromDateKey(dateKey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The DAILY_QUEST_COUNT quests active on a given UTC date. Deterministic:
 * same dateKey -> same quests, everywhere. Picks distinct catalog entries.
 */
export function dailyQuestsFor(dateKey: string): DailyQuestDef[] {
  const rng = new DeterministicRng(seedFromDateKey(dateKey));
  const pool = DAILY_QUEST_CATALOG.slice();
  const picked: DailyQuestDef[] = [];
  const count = Math.min(DAILY_QUEST_COUNT, pool.length);
  for (let i = 0; i < count; i++) {
    const idx = rng.nextUint32() % pool.length;
    picked.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return picked;
}

export function dailyQuestDef(id: string): DailyQuestDef | undefined {
  return DAILY_QUEST_CATALOG.find((q) => q.id === id);
}

// --- Daily streaks (Kintara-style retention layer) ---------------------------
// A streak advances on the FIRST quest claim of each UTC day, and only if the
// previous claim day was exactly yesterday; a missed day resets to 1. The
// streak multiplies daily-quest GOLD only (not xp): +10% per consecutive day
// beyond the first, capped at +50% — bounded, so MAX_DAILY_GOLD stays finite.

/** Maximum streak days that still add bonus (cap: +50% at 6+ days). */
export const STREAK_BONUS_CAP_DAYS = 6;
/** Gold bonus per consecutive day beyond the first. */
export const STREAK_BONUS_PER_DAY = 0.1;

/** "YYYY-MM-DD" for the UTC day immediately before `dateKey`. */
export function prevDateKeyUTC(dateKey: string): string {
  const ms = Date.parse(`${dateKey}T00:00:00.000Z`);
  return dateKeyUTC(new Date(ms - 86_400_000));
}

/**
 * Next streak value when claiming on `todayKey`, given the last day a claim
 * happened (`lastClaimKey`, "" if never). Same-day claims keep the streak.
 */
export function advanceStreak(lastClaimKey: string, todayKey: string, streak: number): number {
  if (lastClaimKey === todayKey) return Math.max(1, streak);
  if (lastClaimKey === prevDateKeyUTC(todayKey)) return Math.max(1, streak) + 1;
  return 1;
}

/** Gold multiplier for a given streak length (1.0 at day 1, capped +50%). */
export function streakGoldMult(streak: number): number {
  const days = Math.max(1, Math.min(STREAK_BONUS_CAP_DAYS, Math.floor(streak)));
  return 1 + STREAK_BONUS_PER_DAY * (days - 1);
}

/** Streak-boosted gold for a quest reward (rounded). */
export function streakGold(baseGold: number, streak: number): number {
  return Math.round(baseGold * streakGoldMult(streak));
}
