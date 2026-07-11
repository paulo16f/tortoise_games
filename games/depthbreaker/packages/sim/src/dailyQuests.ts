// Daily quests — the game's main GOLD faucet (Kintara model: gather/kill/depth
// objectives that pay gold + XP and reset daily). Pure and deterministic: the
// three active quests for a given UTC date are picked from the catalog by a
// DeterministicRng seeded from the date string, so every server agrees on
// "today's quests" without coordination and a client can preview them.
//
// Rewards are bounded (see MAX_DAILY_GOLD) to stay within the wallet-credit
// caps and the Phase 2 economy's faucet accounting.

import { DeterministicRng } from "./rng.js";

export type DailyQuestKind = "gather" | "kill" | "depth";

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
  { id: "reach_depth", kind: "depth", label: "Reach depth 2", target: 2, subject: "", goldReward: 45, xpReward: 150 },
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
