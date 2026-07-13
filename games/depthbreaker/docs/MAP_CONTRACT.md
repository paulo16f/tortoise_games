# Official Map Contract — 3 leveled areas + Coliseum world boss

The design the official map must implement, and exactly what the code needs
from it. Mechanics stay untouched (verified green matrix) — the map plugs in.

## Layout (user's design)

```
                [ Area 2 · Lv 10-20 ]
[ Area 1 · Lv 1-10 ]   [ SPAWN / town ]   [ Area 3 · Lv 30-40 ]
                [ COLISEUM · world boss ]
```

- **Spawn/town hub**: market stall, cooking station, fountain, gold exchange
  NPC point — safe (no spawns).
- **Three combat areas** around the hub, gated by level band. Each area has
  its own **minion, elite, and boss** (distinct meshes — pick from the
  roster below; each is one `EnemyDef` + one `CharacterJob` export line).
- **Coliseum**: separate arena with the **global boss**.

## Enemy roster budget (what the owned packs supply)

Character meshes available for enemies (see SELF_SERVICE_GUIDE.md §1 for the
full lists): 16 PolygonDungeon + 11 DungeonRealms = **27 meshes**, minus 11
used by player variants/skins → **~16 free for enemies**. A natural fit:

| area | minion | elite | boss |
|---|---|---|---|
| 1 (Lv 1-10) | Goblin_Male/Female | Goblin_Warrior_Male | Goblin_WarChief |
| 2 (Lv 10-20) | Skeleton_Slave_01 | Skeleton_Soldier_01/02 | Skeleton_Knight* |
| 3 (Lv 30-40) | Ghost_01 | Tormented_Soul | Rock_Golem |
| Coliseum | — | — | Goblin_Shaman* giant-scaled or Rock_Golem variant |

(*shared with a player form — fine at different scale/tint, or swap.)
Weapon meshes: ~90 SM_Wep_* available; current catalog uses 9 archetypes.

## What the map (mapGen) must expose — the CONTRACT

When the map file/design arrives, `packages/protocol/src/mapGen.ts` +
`DungeonMapDefinition` (map.ts) gain:

```
zones: Array<{
  id: "town" | "area1" | "area2" | "area3" | "coliseum";
  levelBand: [number, number];        // [1,10] / [10,20] / [30,40] / [0,0] town
  bounds: Rect[];                     // walkable region of the zone
  spawnTable: { minion: string; elite: string; boss: string }; // EnemyDef ids
  spawnPoints: Vec2[];                // per-zone spawn locations
}>
coliseumArena: { center: Vec2; radius: number; entrance: Vec2 }
```

Server consumes it zone-aware: the wave spawner picks defs from the zone the
players are in; area bosses use the boss-portal flow per zone; depth scaling
becomes per-zone level scaling (the depthScaling multipliers already exist
and stay).

## Coliseum world boss (the social pressure loop)

- ONE persistent boss level, **global across all rooms**, stored in the
  backend (new table `world_boss (id, level, kills, updated_at)` — the zone
  server reads it on spawn and increments it on kill via /internal).
- Each kill: `level += 1`; hp/damage scale with the existing
  `depthHpMult/depthDamageMult` curves applied to the boss level; rewards
  scale with `scaledXp/scaledCurrency` (all live already — zero new math).
- Result: early kills are solo-able, then the boss outgrows solo damage and
  NEEDS groups — the "bring more people" pressure is emergent from the
  curves, no party-size code required.
- Reward split already works: every player with threat gets the kill credit
  path (awardKill per damage contribution can be added later; v1 =
  killer-takes-loot like today).
- Kill announce goes to world chat (breakDepth pattern reuses directly).

## Implementation order when the map lands

1. Map file in → extend `DungeonMapDefinition` with `zones` (contract above),
   regenerate `navlib`-based smokes pass UNCHANGED (they read the map).
2. Zone-aware spawner in ZoneRoom (~replace randomSpawnPoint with per-zone).
3. New EnemyDefs (one block each in realtime/src/enemies.ts) + their
   CharacterJob export lines (user can do these via SELF_SERVICE_GUIDE §1).
4. Coliseum: world_boss table + /internal/worldboss get/kill + spawn logic.
5. Level-band gate: entering a zone above your band shows a warning (soft
   gate, ARPG style) — server does NOT block, monsters just outlevel you.

Notes: user's level bands are 1-10 / 10-20 / 30-40 (as specified — the 20-30
gap is presumably future Area 2.5 or intentional difficulty jump; confirm
before implementing gates).
