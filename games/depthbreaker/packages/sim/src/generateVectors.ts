// One-shot generator for shared-spec/vectors/*.json.
//
// The TS sim is the reference implementation; running this freezes its output
// as the cross-language contract. Re-run ONLY on a deliberate spec change —
// regenerated vectors invalidate the C# mirrors until they are re-verified.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeterministicRng, deriveStreamSeed, RngStream } from "./rng.js";
import { damageReduction, resolveDamage } from "./combatMath.js";
import { applyHeal, POTION_HEAL_FRACTION } from "./healing.js";
import { XP_TO_NEXT, TOTAL_XP_TO_CAP, totalXpForLevel, levelForTotalXp } from "./xpCurve.js";
import { ThreatTable } from "./threat.js";
import { rollLoot, type LootTable } from "./lootRoller.js";
import { generateDungeonFromSeed, roomCountForDepth } from "./dungeonGraph.js";

const here = dirname(fileURLToPath(import.meta.url));
// packages/sim/src -> games/depthbreaker/shared-spec/vectors
const vectorsDir = join(here, "..", "..", "..", "shared-spec", "vectors");
mkdirSync(vectorsDir, { recursive: true });

function emit(name: string, data: unknown): void {
  writeFileSync(join(vectorsDir, name), JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote ${name}`);
}

// --- rng.json ---------------------------------------------------------------
emit("rng.json", {
  spec: "GAME_MATH_SPEC.md §1 (splitmix32)",
  sequences: [1, 42, 3735928559].map((seed) => {
    const rng = new DeterministicRng(seed);
    return { seed, first8: Array.from({ length: 8 }, () => rng.nextUint32()) };
  }),
  streamSeeds: [
    { seed: 1, streamId: RngStream.Layout, derived: deriveStreamSeed(1, RngStream.Layout) },
    { seed: 1, streamId: RngStream.Loot, derived: deriveStreamSeed(1, RngStream.Loot) },
    { seed: 123456789, streamId: RngStream.Spawns, derived: deriveStreamSeed(123456789, RngStream.Spawns) },
  ],
  ranges: (() => {
    const rng = new DeterministicRng(7);
    return Array.from({ length: 6 }, () => rng.nextRange(1, 11));
  })(),
});

// --- xp_curve.json ----------------------------------------------------------
emit("xp_curve.json", {
  spec: "GAME_MATH_SPEC.md §2 — table is canonical, formula floor(100*L^2.2+0.5) is its generator",
  levelCap: 30,
  xpToNext: XP_TO_NEXT,
  totalXpToCap: TOTAL_XP_TO_CAP,
  totalXpForLevel: [1, 2, 5, 10, 20, 30].map((level) => ({ level, totalXp: totalXpForLevel(level) })),
  levelForTotalXp: [0, 99, 100, 559, 560, 700000, TOTAL_XP_TO_CAP, TOTAL_XP_TO_CAP + 1].map((xp) => ({
    xp,
    level: levelForTotalXp(xp),
  })),
});

// --- damage_reduction.json ---------------------------------------------------
const damageCases = [
  { armor: 0, attackerLevel: 1, raw: 10, isCrit: false },
  { armor: 50, attackerLevel: 1, raw: 10, isCrit: false },
  { armor: 100, attackerLevel: 1, raw: 25, isCrit: false },
  { armor: 100, attackerLevel: 1, raw: 25, isCrit: true },
  { armor: 300, attackerLevel: 1, raw: 100, isCrit: false }, // hits the 75% cap
  { armor: 300, attackerLevel: 10, raw: 100, isCrit: false },
  { armor: 1500, attackerLevel: 30, raw: 200, isCrit: true },
  { armor: 10000, attackerLevel: 30, raw: 4, isCrit: false }, // min-1 floor
  { armor: -25, attackerLevel: 5, raw: 40, isCrit: false }, // negative armor clamps to 0
];
emit("damage_reduction.json", {
  spec: "GAME_MATH_SPEC.md §3 — DR = armor/(armor+100·level) cap 0.75; crit ×1.5 pre-mitigation; floor(x+0.5); min 1",
  cases: damageCases.map((c) => ({
    ...c,
    damageReduction: damageReduction(c.armor, c.attackerLevel),
    finalDamage: resolveDamage(c.raw, c.armor, c.attackerLevel, c.isCrit),
  })),
});

// --- heal_potion.json ---------------------------------------------------------
const healCases = [
  { currentHp: 100, maxHp: 100, fraction: POTION_HEAL_FRACTION }, // full HP -> 0 effective
  { currentHp: 1, maxHp: 100, fraction: POTION_HEAL_FRACTION },
  { currentHp: 80, maxHp: 100, fraction: POTION_HEAL_FRACTION }, // overheal clamps to 20
  { currentHp: 50, maxHp: 101, fraction: POTION_HEAL_FRACTION }, // roundHalfUp(35.35) = 35
  { currentHp: 10, maxHp: 130, fraction: POTION_HEAL_FRACTION }, // roundHalfUp(45.5) = 46
  { currentHp: 0, maxHp: 100, fraction: POTION_HEAL_FRACTION },
  { currentHp: -5, maxHp: 100, fraction: POTION_HEAL_FRACTION }, // hostile hp clamps to 0
  { currentHp: 40, maxHp: 100, fraction: -1 }, // hostile fraction clamps to 0
];
emit("heal_potion.json", {
  spec: "GAME_MATH_SPEC.md — heal = min(missing, roundHalfUp(maxHp·fraction)); overheal excluded from effective",
  potionHealFraction: POTION_HEAL_FRACTION,
  cases: healCases.map((c) => ({ ...c, ...applyHeal(c.currentHp, c.maxHp, c.fraction) })),
});

// --- threat.json ------------------------------------------------------------
// Scenario events replay onto a ThreatTable; expectedTarget is checked after
// each `select` event. melee = entity ids considered in melee range.
interface ThreatEvent {
  op: "damage" | "heal" | "select";
  id?: string;
  amount?: number;
  current?: string | null;
  expectedTarget?: string | null;
}
const threatScenarios: { name: string; melee: string[]; events: ThreatEvent[] }[] = [
  {
    name: "melee needs 110%",
    melee: ["tank", "rogue"],
    events: [
      { op: "damage", id: "tank", amount: 100 },
      { op: "damage", id: "rogue", amount: 105 },
      { op: "select", current: "tank", expectedTarget: "tank" }, // 105 < 110
      { op: "damage", id: "rogue", amount: 6 },
      { op: "select", current: "tank", expectedTarget: "rogue" }, // 111 >= 110
    ],
  },
  {
    name: "ranged needs 130%",
    melee: ["tank"],
    events: [
      { op: "damage", id: "tank", amount: 100 },
      { op: "damage", id: "mage", amount: 125 },
      { op: "select", current: "tank", expectedTarget: "tank" }, // 125 < 130
      { op: "damage", id: "mage", amount: 10 },
      { op: "select", current: "tank", expectedTarget: "mage" }, // 135 >= 130
    ],
  },
  {
    name: "melee 111% beats higher ranged 120%",
    melee: ["rogue"],
    events: [
      { op: "damage", id: "tank", amount: 100 },
      { op: "damage", id: "mage", amount: 120 },
      { op: "damage", id: "rogue", amount: 111 },
      { op: "select", current: "tank", expectedTarget: "rogue" },
    ],
  },
  {
    name: "healing counts half",
    melee: [],
    events: [
      { op: "damage", id: "mage", amount: 100 },
      { op: "heal", id: "healer", amount: 300 }, // 150 threat
      { op: "select", current: "mage", expectedTarget: "healer" }, // 150 >= 130
      { op: "select", current: null, expectedTarget: "healer" },
    ],
  },
];
// Sanity-check scenarios against the implementation before freezing.
for (const scenario of threatScenarios) {
  const table = new ThreatTable();
  const inMelee = (id: string) => scenario.melee.includes(id);
  for (const e of scenario.events) {
    if (e.op === "damage") table.addDamage(e.id!, e.amount!);
    else if (e.op === "heal") table.addHeal(e.id!, e.amount!);
    else {
      const got = table.selectTarget(e.current ?? null, inMelee);
      if (got !== e.expectedTarget) {
        throw new Error(`threat scenario "${scenario.name}": expected ${e.expectedTarget}, got ${got}`);
      }
    }
  }
}
emit("threat.json", { spec: "GAME_MATH_SPEC.md §4", scenarios: threatScenarios });

// --- loot_rolls.json ----------------------------------------------------------
const referenceTable: LootTable = {
  dropChance: 0.4,
  rarityWeights: [
    { rarity: "common", weight: 60 },
    { rarity: "uncommon", weight: 25 },
    { rarity: "rare", weight: 10 },
    { rarity: "epic", weight: 4 },
    { rarity: "legendary", weight: 1 },
  ],
  items: [
    { id: "rusty_blade", rarity: "common", statRanges: [{ stat: "attack", min: 1, max: 4 }] },
    { id: "cloth_hood", rarity: "common", statRanges: [{ stat: "armor", min: 1, max: 3 }] },
    {
      id: "soldier_axe",
      rarity: "uncommon",
      statRanges: [
        { stat: "attack", min: 3, max: 7 },
        { stat: "critChance", min: 1, max: 3 },
      ],
    },
    {
      id: "runed_charm",
      rarity: "rare",
      statRanges: [
        { stat: "attack", min: 5, max: 9 },
        { stat: "hp", min: 10, max: 25 },
      ],
    },
    {
      id: "sunforged_plate",
      rarity: "epic",
      statRanges: [
        { stat: "armor", min: 12, max: 20 },
        { stat: "hp", min: 20, max: 40 },
      ],
    },
    // NOTE: no legendary items — a legendary rarity roll downgrades to epic (§5 step 3).
  ],
};
emit("loot_rolls.json", {
  spec: "GAME_MATH_SPEC.md §5 — RNG call order is normative",
  table: referenceTable,
  sequences: [11, 502, 900913].map((seed) => {
    const rng = new DeterministicRng(deriveStreamSeed(seed, RngStream.Loot));
    return {
      runSeed: seed,
      stream: "Loot",
      rolls: Array.from({ length: 10 }, () => rollLoot(rng, referenceTable)),
    };
  }),
});

// --- dungeon_graphs.json -------------------------------------------------------
emit("dungeon_graphs.json", {
  spec: "GAME_MATH_SPEC.md §6 — tree walk, boss BFS-farthest, treasure seeded dead-end",
  roomCountForDepth: [1, 2, 3, 5].map((depth) => ({ depth, roomCount: roomCountForDepth(depth) })),
  graphs: [
    { seed: 1, roomCount: 8 },
    { seed: 2, roomCount: 8 },
    { seed: 12345, roomCount: 12 },
  ].map(({ seed, roomCount }) => ({
    seed,
    stream: "Layout",
    roomCount,
    graph: generateDungeonFromSeed(seed, roomCount),
  })),
});

console.log("done");
