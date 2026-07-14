// The official hand-built island map, distilled from the Unity export into a
// DungeonMapDefinition the whole game already understands. Walkable land =
// the floor-slab AABBs (officialMapData.FLOOR_RECTS); water = anywhere off
// them; spawn/market/boss come from the authored markers; mining/crystal veins
// are auto-scattered on land (seeded, deterministic — fishing needs no nodes,
// the player clicks the surrounding water). Milestone 1 keeps the existing
// single-boss depth loop; zones/coliseum (the Zone_/Coliseum_ markers) are
// wired in a later milestone.

import { DeterministicRng } from "@depthbreaker/sim";
import type { DungeonMapDefinition, DungeonRoom, Rect, ResourceNodeDef, Vec2 } from "./map.js";
import { FLOOR_RECTS, MAP_MARKERS } from "./officialMapData.js";

const NODE_SEED = 0x15_1a_9d; // fixed: the island map is not per-run random
// The floor-slab AABBs leave sub-player-width gaps where the authored paths
// bridge zones; grow every slab 2u so the whole island is traversable at the
// player's collision radius (probed: pad 0 strands the southern area, pad 2
// connects all 7 zones). The ~2u shoreline overhang is hidden by the terrain.
const LAND_PAD = 2;
const LAND: readonly Rect[] = FLOOR_RECTS.map((r) => ({
  minX: r.minX - LAND_PAD,
  maxX: r.maxX + LAND_PAD,
  minZ: r.minZ - LAND_PAD,
  maxZ: r.maxZ + LAND_PAD,
}));

function inAnyRect(x: number, z: number, rects: readonly Rect[], pad = 0): boolean {
  return rects.some((r) => x >= r.minX + pad && x <= r.maxX - pad && z >= r.minZ + pad && z <= r.maxZ - pad);
}

/** The set of walkable 1u cells reachable on foot from `start` — so every
 *  spawn/node we place is guaranteed to be reachable (the island's floor slabs
 *  include disconnected peripheral bits that must not host nodes). */
function buildReachable(start: Vec2): (x: number, z: number) => boolean {
  const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;
  const seen = new Set<string>([key(start.x, start.z)]);
  const q: Vec2[] = [{ x: Math.round(start.x), z: Math.round(start.z) }];
  while (q.length) {
    const c = q.shift()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = c.x + dx, nz = c.z + dz;
      if (Math.abs(nx) > 300 || Math.abs(nz) > 300) continue;
      const k = key(nx, nz);
      if (seen.has(k) || !inAnyRect(nx, nz, LAND, 0.45)) continue;
      seen.add(k);
      q.push({ x: nx, z: nz });
    }
  }
  // A point counts as reachable if any cell within ~1.5u is in the set.
  return (x, z) => {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (seen.has(key(x + dx, z + dz))) return true;
    return false;
  };
}

function marker(name: string, fallback: Vec2): Vec2 {
  return MAP_MARKERS[name] ?? fallback;
}

/** Scatter `count` land points near a center — on land, reachable from spawn,
 *  clear of avoid points. */
function scatter(
  rng: DeterministicRng,
  center: Vec2,
  radius: number,
  count: number,
  avoid: Vec2[],
  minGap: number,
  reachable: (x: number, z: number) => boolean,
): Vec2[] {
  const out: Vec2[] = [];
  let guard = count * 60;
  while (out.length < count && guard-- > 0) {
    const ang = rng.nextFloat01() * Math.PI * 2;
    const r = Math.sqrt(rng.nextFloat01()) * radius;
    const p = { x: center.x + Math.cos(ang) * r, z: center.z + Math.sin(ang) * r };
    if (!inAnyRect(p.x, p.z, LAND, 1.5)) continue;
    if (!reachable(p.x, p.z)) continue;
    if ([...avoid, ...out].some((a) => Math.hypot(a.x - p.x, a.z - p.z) < minGap)) continue;
    out.push(p);
  }
  return out;
}

export function buildOfficialMap(): DungeonMapDefinition {
  const rng = new DeterministicRng(NODE_SEED);

  const playerSpawn = marker("Spawn_Town", { x: 0, z: 0 });
  const marketStall = marker("Stall_Market", { x: playerSpawn.x - 6, z: playerSpawn.z });
  const cookingStation = { x: marketStall.x + 3, z: marketStall.z + 1 };
  const bossPortal = marker("Boss_Area1", { x: playerSpawn.x, z: playerSpawn.z + 40 });

  const reachable = buildReachable(playerSpawn);
  const zones = [marker("Zone_Area1", playerSpawn), marker("Zone_Area2", playerSpawn), marker("Zone_Area3", playerSpawn)];
  const avoid: Vec2[] = [playerSpawn, marketStall, ...zones];

  // Enemy spawns: a handful per zone so the wave loop keeps ticking.
  const normalSpawns = zones.flatMap((z) => scatter(rng, z, 26, 4, avoid, 6, reachable));
  const eliteSpawns = zones.flatMap((z) => scatter(rng, z, 20, 1, avoid, 8, reachable));

  // Mining/crystal veins: scatter across the zones (crystal rarer, deeper).
  const resourceNodes: ResourceNodeDef[] = [];
  let nid = 0;
  zones.forEach((z, zi) => {
    const irons = scatter(rng, z, 30, 4 + zi, avoid, 7, reachable);
    for (const p of irons) resourceNodes.push({ id: `iron-${nid++}`, kind: "iron_vein", x: p.x, z: p.z });
    const crystals = scatter(rng, z, 26, 1 + zi, avoid, 9, reachable);
    for (const p of crystals) resourceNodes.push({ id: `crystal-${nid++}`, kind: "crystal_vein", x: p.x, z: p.z });
  });
  // Honor any hand-placed node anchors that are reachable too.
  for (const [name, p] of Object.entries(MAP_MARKERS)) {
    if (!reachable(p.x, p.z)) continue;
    if (/^Node_Iron/i.test(name)) resourceNodes.push({ id: `iron-${nid++}`, kind: "iron_vein", x: p.x, z: p.z });
    else if (/^Node_Crystal/i.test(name)) resourceNodes.push({ id: `crystal-${nid++}`, kind: "crystal_vein", x: p.x, z: p.z });
  }

  // Rooms: town at spawn + one per zone (used only for labels/minimap tint).
  const around = (c: Vec2, h: number): Rect => ({ minX: c.x - h, maxX: c.x + h, minZ: c.z - h, maxZ: c.z + h });
  const rooms: DungeonRoom[] = [
    { id: "market", rect: around(playerSpawn, 18) },
    { id: "normal", rect: around(zones[0]!, 28) },
    { id: "elite", rect: around(zones[1]!, 28) },
    { id: "boss", rect: around(zones[2]!, 28) },
  ];

  return {
    tileSize: 1,
    rooms,
    walkable: LAND as Rect[],
    collision: LAND as Rect[],
    floorTiles: [],
    playerSpawn,
    normalSpawns,
    eliteSpawns,
    enemySpawns: normalSpawns,
    waveSpawns: [...normalSpawns, ...eliteSpawns],
    bossPortal,
    props: [],
    visualPlacements: [], // the island GLB provides all visuals
    resourceNodes,
    marketStall,
    cookingStation,
  };
}
