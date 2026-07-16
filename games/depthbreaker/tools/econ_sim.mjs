// Economy v2 sanity simulation: 1,000 player-days of faucets vs sinks, using
// the REAL constants from @depthbreaker/sim. The invariant we care about: net
// gold creation per player-day must sit far below DAILY_EARN_CAP, and sinks
// must scale with activity so heavy players destroy more than casuals mint.
//   npx tsx tools/econ_sim.mjs
import { DAILY_QUEST_CATALOG, DAILY_QUEST_COUNT, MAX_DAILY_GOLD, DAILY_EARN_CAP, FORGE_RECIPES, repairCost, itemDef, DEATH_DURABILITY_COST, itemMaxUses } from "@depthbreaker/sim";
import { AREA_ROSTERS, COLISEUM_BOSS } from "../realtime/src/enemies.js";

const PLAYER_DAYS = 1000;
// Player archetype mix per day: [hours, kills/hr, deaths/hr, gathers/hr, crafts/day]
const ARCHETYPES = [
  { name: "casual", share: 0.6, hours: 1, killsHr: 60, deathsHr: 1, gathersHr: 10, crafts: 0.2 },
  { name: "regular", share: 0.3, hours: 3, killsHr: 80, deathsHr: 1.5, gathersHr: 20, crafts: 0.7 },
  { name: "grinder", share: 0.1, hours: 8, killsHr: 100, deathsHr: 2, gathersHr: 30, crafts: 2 },
];

// Faucets ---------------------------------------------------------------------
const avgDailyQuestGold = (DAILY_QUEST_CATALOG.reduce((s, q) => s + q.goldReward, 0) / DAILY_QUEST_CATALOG.length) * DAILY_QUEST_COUNT;
const spinnerEV = 120 / 20; // 1-in-20 segments pays the 120g jackpot, others pay items

// Per-kill gold EV: mix of minions (90%), elites (9%), bosses (1%) across zones.
const killGoldEV =
  0.9 * (AREA_ROSTERS.reduce((s, r) => s + r.minion.currencyValue, 0) / 3) +
  0.09 * (AREA_ROSTERS.reduce((s, r) => s + r.elite.currencyValue, 0) / 3) +
  0.01 * (AREA_ROSTERS.reduce((s, r) => s + r.boss.currencyValue, 0) / 3);

// Per-kill MATERIAL gold-floor EV (if the player NPC-sells everything — the max
// possible gold faucet from materials; P2P trading moves gold between players
// without minting, so this is the worst case).
function dropEV(def) {
  return (def.drops ?? []).reduce((s, d) => s + d.chance * (d.count ?? 1) * (itemDef(d.itemId)?.sellValue ?? 0), 0);
}
const killMatEV =
  0.9 * (AREA_ROSTERS.reduce((s, r) => s + dropEV(r.minion), 0) / 3) +
  0.09 * (AREA_ROSTERS.reduce((s, r) => s + dropEV(r.elite), 0) / 3) +
  0.01 * (AREA_ROSTERS.reduce((s, r) => s + dropEV(r.boss), 0) / 3);
const gatherMatEV = 5; // ~1-2 ore/shard per node at the 4-10g floors
// Fraction of drops a player actually NPC-sells at the floor (the rest is
// consumed by crafting or traded P2P, which moves gold without minting it).
const NPC_SELL_FRACTION = 0.6;

// Sinks -----------------------------------------------------------------------
const avgForgeFee = FORGE_RECIPES.reduce((s, r) => s + r.goldCost, 0) / FORGE_RECIPES.length;
const avgRepair = repairCost("ember_blade"); // mid-tier weapon
const deathsPerRepair = Math.floor((itemMaxUses("ember_blade") ?? 100) / DEATH_DURABILITY_COST) * 0.7; // repair before break
const toolReplaceEV = 15 / 60; // starter tool: 15g per 60 gathers (forged tier is cheaper/use but costs materials)
const potionsPerHour = 2 * (itemDef("health_potion")?.buyValue ?? 20) * 0.5; // ~1 potion/hr bought

let minted = 0, destroyed = 0;
for (const a of ARCHETYPES) {
  const days = PLAYER_DAYS * a.share;
  const kills = a.killsHr * a.hours;
  const deaths = a.deathsHr * a.hours;
  const gathers = a.gathersHr * a.hours;
  const faucet = Math.min(
    DAILY_EARN_CAP,
    avgDailyQuestGold * 1.25 + spinnerEV + kills * (killGoldEV + killMatEV * NPC_SELL_FRACTION) + gathers * gatherMatEV * NPC_SELL_FRACTION,
  );
  const sink =
    a.crafts * avgForgeFee +
    (deaths / Math.max(1, deathsPerRepair)) * avgRepair +
    gathers * toolReplaceEV +
    a.hours * potionsPerHour;
  minted += days * faucet;
  destroyed += days * sink;
  console.log(`${a.name.padEnd(8)} faucet/day ≈ ${faucet.toFixed(0)}g   sinks/day ≈ ${sink.toFixed(0)}g   net ${(faucet - sink).toFixed(0)}g`);
}

const netPerDay = (minted - destroyed) / PLAYER_DAYS;
console.log(`\n${PLAYER_DAYS} player-days: minted ${Math.round(minted)}g, destroyed ${Math.round(destroyed)}g`);
console.log(`net creation ≈ ${netPerDay.toFixed(0)}g per player-day (cap ${DAILY_EARN_CAP}; dailies max ${MAX_DAILY_GOLD} base)`);
if (netPerDay > DAILY_EARN_CAP * 0.2) {
  console.error("⚠️  net gold creation exceeds 20% of the daily cap — tighten faucets or deepen sinks.");
  process.exit(1);
}
console.log("✅ faucet/sink balance within tolerance");
