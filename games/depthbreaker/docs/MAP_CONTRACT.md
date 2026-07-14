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

---

## Naming convention — how the export auto-classifies meshes (BETA pipeline)

The map is definitive but a **beta**: a teammate keeps adding meshes. Nothing
needs hand-wiring per mesh — the Unity exporter (`games/map/Assets/Editor/
DepthbreakerMapExport.cs`) classifies **by mesh name**, then `npm run sync:map`
distils it. Keep names in these buckets and re-export; new geometry just works.

**Walkable floor** — name contains `Floor` / `Path` / `Platform` / `Bridge` /
`Stair`. The player stands on the **lowest** up-facing floor per cell, so they
walk *under* arches/overhangs and *on* the ground. A **`Bridge`** deck is the
exception: where a bridge covers a cell you walk **on** the deck (the ground
around it stays walkable, so a low crossing never disappears).

**Collision** (player can't pass; per-cell body-height test, so wall **openings/
doorways stay open**) — name contains `Wall` `Pillar` `Rock` `Cliff` `Tree`
`Birch` `Trunk` `Bramble` `Bush` `Crystal` `Well` `Statue` `Brazier` `Barrel`
`Crate` `Chest` `Column` `Obelisk` `Fence` `Balustrade` `Rubble` `Forge`
`Smelter` `Anvil` `Gate` `Building` `Market` `Duct` `Boulder`, or any solid
`Lava*` **structure**. NOT obstacles: `Bridge`/`Stair`/arch **spans** (you pass
under/over them) — their support pillars still block via `Pillar`.

**Hazard** — the lava **plane** only (`*Lava*Plane*`): non-walkable, you can't
stand on it. Solid lava structures (ducts, pillars) collide like any obstacle.

**Functional objects = the map's OWN buildings** (no procedural model rendered):
- **Fountain / heal safe-zone** → the stone circle at the `Spawn_Town` empty.
- **Market** (sell resources) → the `weapon_market` cabin mesh.
- **Cooking** (cook fish) → the `BakeryMarket` cabin mesh.
The client hides its placeholder basin/chest/campfire and puts the interaction
on the building. Keep these mesh names stable, or update the `featureCentre`
map in `tools/build_official_map.mjs`.

**Marker empties** (leaf transforms, exported as points): `Spawn_Town`,
`Zone_Area{1,2,3}`, `Boss_Area{1,2,3}`, `Coliseum_Center`, `Stall_Market`,
`Node_{Iron|Crystal|Fish}_NN`. Add more with the same prefixes.

**Round trip:** teammate edits the scene → `Depthbreaker ▸ Export Map` in Unity
→ `npm run sync:map` → the game reflects it (walkability, collision, features,
markers). Textures: Synty atlases mostly embed; a few materials (the dwarven
walls, `HighLevelFloor`) are re-tinted/re-atlased client-side in `IslandMap.tsx`
because the FBX→glTF chain drops their base-colour link.
