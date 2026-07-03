# Depthbreaker Game Math Spec

Language-neutral, normative contract for all deterministic game math. Two implementations are bound to it:

- **TypeScript reference:** `games/depthbreaker/backend/src/sim/` — tested against `vectors/*.json` by vitest (`npm test`).
- **C# mirror:** `games/depthbreaker/unity/Assets/Scripts/Shared/` — must produce identical outputs; C# test execution is deferred until a Unity-capable machine (tracked in the game README).

The JSON files in `vectors/` are **frozen**. They were generated once by the TS reference (`npm run generate:vectors`). Regenerate only on a deliberate spec change, and treat every C# mirror as unverified until re-checked.

Integer semantics: all "uint32" values are unsigned 32-bit with wrapping arithmetic (`>>> 0` + `Math.imul` in JS; `uint` in C#). All floats are IEEE 754 doubles.

## 1. Deterministic RNG (splitmix32)

State: one uint32. Constructed from a uint32 seed.

```
nextUint32():
    state = (state + 0x9E3779B9) mod 2^32
    z = state
    z = z XOR (z >> 16);  z = (z * 0x21F0AAAD) mod 2^32
    z = z XOR (z >> 15);  z = (z * 0x735A2D97) mod 2^32
    z = z XOR (z >> 15)
    return z

nextFloat01():  nextUint32() / 4294967296          # [0, 1)
nextRange(minIncl, maxExcl):  minIncl + nextUint32() mod (maxExcl - minIncl)
```

Modulo bias in `nextRange` is accepted and part of the contract (spans are tiny relative to 2^32). `>>` is a logical (unsigned) right shift.

**Substreams.** Systems never share a sequence, so one system consuming a roll cannot shift another's:

```
deriveStreamSeed(seed32, streamId) =
    new Rng( (seed32 XOR (streamId * 0x9E3779B9 mod 2^32)) mod 2^32 ).nextUint32()
```

Stream ids: `Layout = 1`, `Loot = 2`, `Spawns = 3`.

Spot values (full sets in `vectors/rng.json`): seed 1 → first outputs `1580013426, 350525680, 3524174333, …`; `deriveStreamSeed(1, Layout) = 4293442868`.

## 2. XP Curve

Levels 1–30 within a run (run axis; resets on death). The 29-entry table is **canonical data**, not a runtime formula — it was generated once from `floor(100 · L^2.2 + 0.5)` and frozen so cross-platform `pow` rounding can never desync implementations.

```
XP_TO_NEXT[L] for L = 1..29 (see vectors/xp_curve.json for the full table):
100, 459, 1121, 2111, 3449, 5151, 7231, 9701, 12570, 15849, 19546, 23670,
28228, 33226, 38672, 44572, 50932, 57756, 65052, 72823, 81074, 89811,
99038, 108759, 118978, 129700, 140929, 152668, 164921
```

- `xpToNext(L)` = table value for L in 1..29; `0` for L ≥ 30 (cap).
- `totalXpForLevel(L)` = sum of `XP_TO_NEXT[1..L-1]`; total to cap = **1,578,097**.
- `levelForTotalXp(xp)` = highest reachable level, capped at 30; negative xp clamps to 0.

## 3. Damage Model

Constants: `ARMOR_K_PER_LEVEL = 100`, `MAX_DAMAGE_REDUCTION = 0.75`, `CRIT_MULTIPLIER = 1.5`, `GCD_SECONDS = 1.0`.

```
roundHalfUp(x) = floor(x + 0.5)        # specified because JS Math.round and
                                        # C# Math.Round disagree on .5 ties

damageReduction(armor, attackerLevel):
    a = max(0, armor);  L = max(1, attackerLevel)
    return min(0.75, a / (a + 100 · L))

resolveDamage(raw, targetArmor, attackerLevel, isCrit):
    r = isCrit ? raw · 1.5 : raw       # crit applies BEFORE mitigation
    return max(1, roundHalfUp(r · (1 − damageReduction(...))))
```

A landed hit always deals at least 1. Whether a hit crits is rolled by the zone server (crit chance stat); this spec only fixes the arithmetic. Vectors: `vectors/damage_reduction.json`.

## 4. Threat / Aggro

Constants: damage = `1.0` threat per point; healing = `0.5` per **effective** point (caller splits healing threat across enemies in combat with the healer; overheal generates none). Swap thresholds: `1.1` when the candidate is in melee range of the enemy, `1.3` otherwise.

`selectTarget(current, isInMeleeRange)`:

1. Empty table → `null`. `current` null or absent from table → highest-threat entity.
2. Order entities by threat descending, ties by ascending entity id (determinism).
3. Walk candidates above `current`; a candidate wins if `threat ≥ threat(current) × threshold(candidate)`. The highest-threat qualifying candidate wins (checked in order, so a melee at 111% can out-prioritize a ranged at 120%).
4. No qualifier → keep `current`.

Scenario vectors (replayable event scripts): `vectors/threat.json`.

## 5. Loot Rolls

Types: a `LootTable` has `dropChance` ∈ [0,1], ordered `rarityWeights` (`common/uncommon/rare/epic/legendary`), and ordered `items` (each with a rarity and ordered integer `statRanges`, max inclusive).

**RNG call order is normative** (stream: `Loot`):

1. One `nextFloat01()`; `≥ dropChance` → no drop, consume nothing further.
2. One `nextUint32() mod totalWeight` for rarity; walk `rarityWeights` in declared order subtracting weights.
3. If the rolled rarity has no items, downgrade one rarity toward common until items exist (**no RNG consumed**); if none anywhere → no drop.
4. One `nextUint32() mod count` to pick among that rarity's items in declared order.
5. Per `statRange` in declared order: one `nextRange(min, max + 1)`.

Reference table + 3 frozen 10-roll sequences: `vectors/loot_rolls.json`.

## 6. Dungeon Layout

Seeded random walk on a 2D grid producing a **tree** (each room doors only to the room it grew from) — connectivity guaranteed, dead-ends guaranteed. Stream: `Layout`.

```
DIRS (normative order): N(0,+1), E(+1,0), S(0,−1), W(−1,0)

generate(rng, roomCount):                 # roomCount ≥ 2
    rooms = [start at (0,0), index 0]
    while |rooms| < roomCount:
        parent = rooms[nextUint32() mod |rooms|]
        dir    = DIRS[nextUint32() mod 4]
        cell   = parent + dir
        if cell occupied: continue        # rejected attempts still consumed 2 rolls
        add room(index = |rooms|, kind = combat), door parent↔child
```

- **Boss:** BFS from room 0 (neighbors in ascending index); the room with max distance, ties to the lowest index. Kind → `boss`.
- **Treasure:** among rooms with exactly one door, excluding start and boss, in ascending index order: `deadEnds[nextUint32() mod count]`. **If no candidates exist, no RNG is consumed** and `treasureIndex = −1`. Kind → `treasure`.
- `roomCountForDepth(depth) = 8 + 2 · max(0, depth − 1)`.

The zone server generates authoritatively and network-spawns rooms; clients may rebuild the identical graph from the seed for geometry-only purposes. Vectors: `vectors/dungeon_graphs.json`.

## 7. Run-Report Plausibility Bounds (backend-only)

The backend never re-simulates; it caps what `/internal/runs/:id/finish` may claim so a leaked zone secret or zone bug cannot mint unbounded progression. Tuning constants, not gameplay math:

```
maxXpForDepth(depth)       = 5000 · max(1, depth)
maxCurrencyForDepth(depth) = 100 + 60 · max(0, depth)
MAX_PLAUSIBLE_DEPTH        = 50
```

Reports exceeding any bound are rejected with HTTP 422 and logged.
