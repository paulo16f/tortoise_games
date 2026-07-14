// The official hand-built island map. Walkability + surface height come from a
// raycast grid (WALK_GRID) so only the real stone blocks are walkable (gaps,
// water and lava are excluded) and the player follows ramps/reliefs. The
// floor-slab AABBs (BOUND_RECTS) are used only for the map extent. Spawn/market/
// boss come from the authored markers; mining/crystal veins auto-scatter on
// reachable land (fishing needs no nodes — the player clicks the water).

import { DeterministicRng } from "@depthbreaker/sim";
import type { DungeonArea, DungeonMapDefinition, DungeonRoom, Rect, ResourceNodeDef, Vec2 } from "./map.js";
import { BLOCK_RECTS, BOUND_RECTS, MAP_FEATURES, MAP_MARKERS, WALK_GRID } from "./officialMapData.js";

const NODE_SEED = 0x15_1a_9d;

// --- Grid sampler (decode the packed walkability + height once) ---
function decodeB64(s: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
const BITS = decodeB64(WALK_GRID.bits);
const HGT = decodeB64(WALK_GRID.height);
const { originX, originZ, cell, cols, rows, heightQ } = WALK_GRID;

function cellIndex(x: number, z: number): number {
  const gx = Math.round((x - originX) / cell);
  const gz = Math.round((z - originZ) / cell);
  if (gx < 0 || gx >= cols || gz < 0 || gz >= rows) return -1;
  return gz * cols + gx;
}
/** True if (x,z) sits inside an obstacle footprint (wall/pillar/building) — the
 *  player collides with these, so they're carved out of walkability. */
function isBlocked(x: number, z: number): boolean {
  for (const r of BLOCK_RECTS) if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return true;
  return false;
}
/** Is the stone block under (x,z) walkable? (water/lava/gaps → false) */
export function gridWalkable(x: number, z: number): boolean {
  const i = cellIndex(x, z);
  return i >= 0 && (BITS[i >> 3]! & (1 << (i & 7))) !== 0;
}
/** Surface height at (x,z); 0 off the map. */
export function gridHeight(x: number, z: number): number {
  const i = cellIndex(x, z);
  return i >= 0 ? HGT[i]! / heightQ : 0;
}
/** Nearest walkable point to (x,z) — outward ring search on the grid. */
export function gridNearestWalkable(x: number, z: number): Vec2 {
  if (gridWalkable(x, z)) return { x, z };
  for (let r = 1; r <= 60; r++) {
    for (let a = 0; a < r * 8; a++) {
      const ang = (a / (r * 8)) * Math.PI * 2;
      const px = x + Math.cos(ang) * r * cell;
      const pz = z + Math.sin(ang) * r * cell;
      if (gridWalkable(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

// --- Node/spawn scatter over reachable walkable land ---
function marker(name: string, fallback: Vec2): Vec2 {
  return MAP_MARKERS[name] ?? fallback;
}

interface Reachable {
  contains: (x: number, z: number) => boolean;
  nearest: (x: number, z: number) => Vec2;
}

/** Grid cells reachable on foot from `start` (flood over the walkable grid).
 *  A neighbour joins if it's grid-walkable AND not an obstacle footprint — so
 *  ALL the real floor (every level, ramps, reliefs) is walkable, and only
 *  collision (walls/buildings/lava, carved from the grid) and the off-map void
 *  (water) are excluded. Matches the authored map 1:1. */
function buildReachable(start: Vec2): Reachable {
  const key = (gx: number, gz: number) => gz * cols + gx;
  const gridWalkAt = (gx: number, gz: number) => {
    if (gx < 0 || gx >= cols || gz < 0 || gz >= rows) return false;
    const i = gz * cols + gx;
    if ((BITS[i >> 3]! & (1 << (i & 7))) === 0) return false;
    return !isBlocked(originX + gx * cell, originZ + gz * cell); // wall/building footprints collide
  };

  const sgx = Math.round((start.x - originX) / cell);
  const sgz = Math.round((start.z - originZ) / cell);
  const seen = new Set<number>([key(sgx, sgz)]);
  // Head-index queue, not q.shift() (O(n) vs O(n²)) — the 0.5u grid floods
  // ~120k cells, so a shift-based BFS would stall the map build.
  const q: [number, number][] = [[sgx, sgz]];
  for (let head = 0; head < q.length; head++) {
    const [gx, gz] = q[head]!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = gx + dx, nz = gz + dz;
      const k = key(nx, nz);
      if (seen.has(k) || !gridWalkAt(nx, nz)) continue;
      seen.add(k);
      q.push([nx, nz]);
    }
  }
  const contains = (x: number, z: number) => {
    const gx = Math.round((x - originX) / cell), gz = Math.round((z - originZ) / cell);
    if (gx < 0 || gx >= cols || gz < 0 || gz >= rows) return false;
    return seen.has(key(gx, gz));
  };
  const nearest = (x: number, z: number): Vec2 => {
    if (contains(x, z)) return { x, z };
    for (let r = 1; r <= 80; r++) {
      for (let a = 0; a < r * 8; a++) {
        const ang = (a / (r * 8)) * Math.PI * 2;
        const px = x + Math.cos(ang) * r * cell;
        const pz = z + Math.sin(ang) * r * cell;
        if (contains(px, pz)) return { x: px, z: pz };
      }
    }
    return { x: start.x, z: start.z }; // spawn is always reachable — never hand back a non-walkable point
  };
  return { contains, nearest };
}

function scatter(rng: DeterministicRng, center: Vec2, radius: number, count: number, avoid: Vec2[], minGap: number, reachable: (x: number, z: number) => boolean): Vec2[] {
  const out: Vec2[] = [];
  let guard = count * 80;
  while (out.length < count && guard-- > 0) {
    const ang = rng.nextFloat01() * Math.PI * 2;
    const r = Math.sqrt(rng.nextFloat01()) * radius;
    const p = { x: center.x + Math.cos(ang) * r, z: center.z + Math.sin(ang) * r };
    if (!reachable(p.x, p.z)) continue;
    if ([...avoid, ...out].some((a) => Math.hypot(a.x - p.x, a.z - p.z) < minGap)) continue;
    out.push(p);
  }
  return out;
}

// The official map is deterministic (seed-independent), but ~8 client components
// call buildDungeon() → buildOfficialMap(). Build it ONCE and hand back the same
// instance (the grid flood + node scatter aren't cheap, especially at 0.5u).
let cachedMap: DungeonMapDefinition | null = null;
export function buildOfficialMap(): DungeonMapDefinition {
  if (cachedMap) return cachedMap;
  const rng = new DeterministicRng(NODE_SEED);

  const playerSpawn = marker("Spawn_Town", { x: 0, z: 0 });
  const bossPortal = marker("Boss_Area1", { x: playerSpawn.x, z: playerSpawn.z + 40 });
  const reachable = buildReachable(playerSpawn);

  // Market/cooking sit on the map's OWN cabins (weapon_market / BakeryMarket
  // meshes → MAP_FEATURES). The cabin centre is inside the solid building, so
  // walk OUT of it toward the spawn plaza (the door side) to the first walkable
  // cell — the interaction lands in front of the cabin, not on a random edge.
  const featureSpot = (key: string, fallback: Vec2): Vec2 => {
    const c = MAP_FEATURES[key] ?? fallback;
    if (reachable.contains(c.x, c.z)) return c;
    const dx = playerSpawn.x - c.x, dz = playerSpawn.z - c.z;
    const len = Math.hypot(dx, dz) || 1;
    for (let step = 1; step <= 30; step += 0.5) {
      const p = { x: c.x + (dx / len) * step, z: c.z + (dz / len) * step };
      if (reachable.contains(p.x, p.z)) return p;
    }
    return reachable.nearest(c.x, c.z);
  };
  const marketStall = featureSpot("market", marker("Stall_Market", { x: playerSpawn.x - 6, z: playerSpawn.z }));
  const cookingStation = featureSpot("cooking", { x: marketStall.x + 3, z: marketStall.z + 1 });

  const zones = [marker("Zone_Area1", playerSpawn), marker("Zone_Area2", playerSpawn), marker("Zone_Area3", playerSpawn)];
  const avoid: Vec2[] = [playerSpawn, marketStall, ...zones];

  // Scatter per-zone so each leveled area keeps its own spawn set (band roster).
  const perZoneNormal = zones.map((z) => scatter(rng, z, 26, 4, avoid, 6, reachable.contains));
  const perZoneElite = zones.map((z) => scatter(rng, z, 20, 1, avoid, 8, reachable.contains));
  const normalSpawns = perZoneNormal.flat();
  const eliteSpawns = perZoneElite.flat();
  const BAND = [10, 20, 40];
  const areas: DungeonArea[] = zones.map((z, i) => {
    const bp = marker(`Boss_Area${i + 1}`, { x: z.x, z: z.z + 8 });
    return {
      id: i + 1,
      center: z,
      bandLevel: BAND[i]!,
      normalSpawns: perZoneNormal[i]!,
      eliteSpawns: perZoneElite[i]!,
      bossPoint: reachable.contains(bp.x, bp.z) ? bp : reachable.nearest(bp.x, bp.z),
    };
  });
  const cc = marker("Coliseum_Center", { x: playerSpawn.x, z: playerSpawn.z - 60 });
  const coliseumPortal = reachable.contains(cc.x, cc.z) ? cc : reachable.nearest(cc.x, cc.z);

  const resourceNodes: ResourceNodeDef[] = [];
  let nid = 0;
  zones.forEach((z, zi) => {
    for (const p of scatter(rng, z, 30, 4 + zi, avoid, 7, reachable.contains)) resourceNodes.push({ id: `iron-${nid++}`, kind: "iron_vein", x: p.x, z: p.z });
    for (const p of scatter(rng, z, 26, 1 + zi, avoid, 9, reachable.contains)) resourceNodes.push({ id: `crystal-${nid++}`, kind: "crystal_vein", x: p.x, z: p.z });
  });
  for (const [name, p] of Object.entries(MAP_MARKERS)) {
    if (!reachable.contains(p.x, p.z)) continue;
    if (/^Node_Iron/i.test(name)) resourceNodes.push({ id: `iron-${nid++}`, kind: "iron_vein", x: p.x, z: p.z });
    else if (/^Node_Crystal/i.test(name)) resourceNodes.push({ id: `crystal-${nid++}`, kind: "crystal_vein", x: p.x, z: p.z });
  }

  const around = (c: Vec2, h: number): Rect => ({ minX: c.x - h, maxX: c.x + h, minZ: c.z - h, maxZ: c.z + h });
  const rooms: DungeonRoom[] = [
    { id: "market", rect: around(playerSpawn, 18) },
    { id: "normal", rect: around(zones[0]!, 28) },
    { id: "elite", rect: around(zones[1]!, 28) },
    { id: "boss", rect: around(zones[2]!, 28) },
  ];

  cachedMap = {
    tileSize: 1,
    rooms,
    // BOUND_RECTS give the map extent; the grid is the real walkability.
    walkable: BOUND_RECTS as Rect[],
    collision: BOUND_RECTS as Rect[],
    // Walkability = the step-limited reachable ground (not the raw grid), so
    // scenery block-tops and the void are excluded. Height stays the raw grid.
    sampleWalkable: reachable.contains,
    sampleHeight: gridHeight,
    sampleNearest: reachable.nearest,
    floorTiles: [],
    playerSpawn,
    normalSpawns,
    eliteSpawns,
    enemySpawns: normalSpawns,
    waveSpawns: [...normalSpawns, ...eliteSpawns],
    bossPortal,
    props: [],
    visualPlacements: [],
    resourceNodes,
    marketStall,
    cookingStation,
    areas,
    coliseumPortal,
  };
  return cachedMap;
}
