// Seeded dungeon builder: turns the deterministic room graph from
// @depthbreaker/sim into a concrete, world-space DungeonMapDefinition. This is
// the bridge that was missing - the graph generator was fully built and tested
// but wired to nothing visual. Because the run seed is already synced to both
// the realtime server and the client, each side calls buildDungeon(seed, depth)
// locally and gets byte-identical geometry with no extra netcode.
//
// This module imports only TYPES from ./map.js (erased at runtime), so map.ts
// can import buildDungeon at runtime to define DEPTHBREAKER_DUNGEON without a
// runtime import cycle.

import {
  DeterministicRng,
  deriveStreamSeed,
  RngStream,
  generateDungeonFromSeed,
  roomCountForDepth,
  type Room,
} from "@depthbreaker/sim";
import { buildOfficialMap } from "./officialMap.js";
import type {
  DungeonMapDefinition,
  DungeonProp,
  DungeonRoom,
  DungeonRoomId,
  DungeonVisualPlacement,
  Rect,
  ResourceNodeDef,
  Vec2,
} from "./map.js";

/** Default seed/depth for the module-level DEPTHBREAKER_DUNGEON fallback. */
export const DEFAULT_SEED = 1;
export const DEFAULT_DEPTH = 1;

const TILE = 5;
const ROOM_TILES = 4; // each room is 4x4 tiles = 20x20 world units
const ROOM_HALF = (ROOM_TILES * TILE) / 2; // 10
const PITCH = 30; // world distance between grid-adjacent room centers (leaves a 10u corridor gap)
const CORRIDOR_HALF = TILE; // corridors are 2 tiles (10u) wide
const FLOOR_SCALE = 1.03;

type PropAsset = DungeonProp["asset"];

const ROOM_TINT: Record<DungeonRoomId, string> = {
  market: "#857a5a",
  normal: "#686f72",
  elite: "#635c87",
  boss: "#7c5355",
};
const CORRIDOR_TINT = "#5d666c";

// Per-asset base scale so generated props read at the same size the
// hand-authored layout used (the source GLBs are small and need scaling up).
const PROP_SCALE: Record<PropAsset, number> = {
  bones: 1.7,
  crystal: 2.8,
  crystal_alt: 3.3,
  mushroom: 2.1,
  mushroom_alt: 2.4,
  rocks: 2.7,
  skull: 1.2,
  stairs: 4.5,
  chest_closed: 2.2,
  chest_open: 2.6,
  campfire: 2.2,
  crate: 5.5,
};

const PROP_TEMPLATES: Record<DungeonRoomId, PropAsset[]> = {
  market: ["chest_closed", "crate", "campfire"],
  normal: ["bones", "rocks", "skull", "crystal", "mushroom"],
  elite: ["crystal_alt", "skull", "rocks", "mushroom_alt"],
  boss: ["skull", "crystal_alt", "bones"],
};

function roomCenter(room: Room): Vec2 {
  return { x: room.x * PITCH, z: room.y * PITCH };
}

function roomRect(room: Room): Rect {
  const c = roomCenter(room);
  return { minX: c.x - ROOM_HALF, maxX: c.x + ROOM_HALF, minZ: c.z - ROOM_HALF, maxZ: c.z + ROOM_HALF };
}

// A corridor between two grid-adjacent rooms. Spans center-to-center along the
// varying axis (so it overlaps both rooms and cannot leave a seam gap) and is
// CORRIDOR_HALF*2 wide along the fixed axis.
function corridorRect(a: Room, b: Room): Rect {
  const ca = roomCenter(a);
  const cb = roomCenter(b);
  if (a.y === b.y) {
    const loX = Math.min(ca.x, cb.x);
    const hiX = Math.max(ca.x, cb.x);
    return { minX: loX, maxX: hiX, minZ: ca.z - CORRIDOR_HALF, maxZ: ca.z + CORRIDOR_HALF };
  }
  const loZ = Math.min(ca.z, cb.z);
  const hiZ = Math.max(ca.z, cb.z);
  return { minX: ca.x - CORRIDOR_HALF, maxX: ca.x + CORRIDOR_HALF, minZ: loZ, maxZ: hiZ };
}

function roomIdFor(room: Room, elite: boolean): DungeonRoomId {
  if (room.kind === "start") return "market";
  if (room.kind === "boss") return "boss";
  if (room.kind === "treasure") return "market";
  return elite ? "elite" : "normal";
}

// Floor tiles for a rect, matching the original buildFloorPlacements() stepping
// (inset by half a tile, TILE grid), tagged with a tint. Dedupe is handled by
// the caller so overlapping room/corridor rects don't double-place.
function tilesForRect(rect: Rect, tint: string, seen: Set<string>, out: DungeonVisualPlacement[]): void {
  for (let x = rect.minX + TILE / 2; x <= rect.maxX - TILE / 2 + 1e-6; x += TILE) {
    for (let z = rect.minZ + TILE / 2; z <= rect.maxZ - TILE / 2 + 1e-6; z += TILE) {
      const key = `${x.toFixed(2)}:${z.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ asset: "floor", x, z, scale: FLOOR_SCALE, tint });
    }
  }
}

/**
 * Build a full, world-space dungeon from a run seed and depth. Pure and
 * deterministic: the same (seed, depth) always yields a deep-equal map, so the
 * server and client (which both import this one function) never disagree.
 */
/** When true, every buildDungeon call returns the hand-built island map
 *  (seed/depth ignored — one official world) instead of a procedural dungeon.
 *  Server, client, and the navlib smokes all read buildDungeon, so this single
 *  switch moves the whole game onto the island. */
export const USE_OFFICIAL_MAP = true;

export function buildDungeon(seed32: number, depth: number): DungeonMapDefinition {
  if (USE_OFFICIAL_MAP) return buildOfficialMap();
  return buildProceduralDungeon(seed32, depth);
}

/** The original seeded procedural dungeon (now a fallback behind the official
 *  map switch). Kept fully tested — it's the generator, not dead code. */
export function buildProceduralDungeon(seed32: number, depth: number): DungeonMapDefinition {
  const graph = generateDungeonFromSeed(seed32, roomCountForDepth(depth));
  // Separate substream for dressing (elite promotion, spawn jitter, props) so it
  // never disturbs the frozen graph replay.
  const dress = new DeterministicRng(deriveStreamSeed(seed32, RngStream.Spawns));

  // Promote a seeded subset of combat rooms to "elite".
  const combatIndices = graph.rooms.filter((r) => r.kind === "combat").map((r) => r.index);
  const eliteCount = Math.min(combatIndices.length, Math.max(combatIndices.length >= 2 ? 1 : 0, Math.floor(combatIndices.length / 3)));
  const eliteSet = new Set<number>();
  const pool = [...combatIndices];
  for (let i = 0; i < eliteCount && pool.length > 0; i++) {
    const pick = dress.nextUint32() % pool.length;
    eliteSet.add(pool[pick]!);
    pool.splice(pick, 1);
  }

  const rooms: DungeonRoom[] = [];
  const walkable: Rect[] = [];
  const roomInfo = new Map<number, { id: DungeonRoomId; rect: Rect; center: Vec2 }>();

  for (const room of graph.rooms) {
    const id = roomIdFor(room, eliteSet.has(room.index));
    const rect = roomRect(room);
    rooms.push({ id, rect });
    walkable.push(rect);
    roomInfo.set(room.index, { id, rect, center: roomCenter(room) });
  }

  // Corridors: one per undirected edge (dedupe a<b).
  const corridorRects: Rect[] = [];
  for (const room of graph.rooms) {
    for (const door of room.doors) {
      if (room.index >= door) continue;
      const other = graph.rooms[door];
      if (!other) continue;
      corridorRects.push(corridorRect(room, other));
    }
  }
  walkable.push(...corridorRects);

  // Floors: rooms first (their tint wins overlap dedupe), then corridors.
  const seen = new Set<string>();
  const floorPlacements: DungeonVisualPlacement[] = [];
  for (const info of roomInfo.values()) tilesForRect(info.rect, ROOM_TINT[info.id], seen, floorPlacements);
  for (const rect of corridorRects) tilesForRect(rect, CORRIDOR_TINT, seen, floorPlacements);

  // Spawns + boss portal + props.
  const startCenter = roomInfo.get(0)?.center ?? { x: 0, z: 0 };
  const bossCenter = roomInfo.get(graph.bossIndex)?.center ?? startCenter;
  const normalSpawns: Vec2[] = [];
  const eliteSpawns: Vec2[] = [];
  const props: DungeonProp[] = [];
  const propPlacements: DungeonVisualPlacement[] = [];

  const jitter = (center: Vec2, minR: number, maxR: number): Vec2 => {
    const angle = dress.nextFloat01() * Math.PI * 2;
    const radius = minR + dress.nextFloat01() * (maxR - minR);
    return { x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius };
  };

  for (const room of graph.rooms) {
    const info = roomInfo.get(room.index)!;
    const center = info.center;

    // Enemy spawns for combat rooms (never the start/treasure/boss rooms).
    if (room.kind === "combat") {
      const spawns = info.id === "elite" ? eliteSpawns : normalSpawns;
      const count = 1 + (dress.nextUint32() % 2); // 1-2 per room
      for (let i = 0; i < count; i++) spawns.push(jitter(center, 0, ROOM_HALF - 4));
    }

    // Props: 2-4 per room from the room's template, kept off the center.
    const template = PROP_TEMPLATES[info.id];
    const propCount = 2 + (dress.nextUint32() % 3); // 2-4
    for (let i = 0; i < propCount; i++) {
      const asset = template[dress.nextUint32() % template.length]!;
      const pos = jitter(center, 3, ROOM_HALF - 2);
      const yaw = dress.nextFloat01() * Math.PI * 2;
      const scale = PROP_SCALE[asset] * (0.85 + dress.nextFloat01() * 0.3);
      props.push({ asset, x: pos.x, z: pos.z, yaw });
      propPlacements.push({ asset, x: pos.x, z: pos.z, yaw, scale });
    }
  }

  // Mining nodes: a separate pass AFTER all other dressing draws, so adding
  // nodes never disturbs the spawn/prop layout an existing seed already has.
  // 1-2 per combat room, near the room edge; elite rooms bias toward crystal.
  const resourceNodes: ResourceNodeDef[] = [];
  for (const room of graph.rooms) {
    if (room.kind !== "combat") continue;
    const info = roomInfo.get(room.index)!;
    const count = 1 + (dress.nextUint32() % 2);
    for (let i = 0; i < count; i++) {
      const crystalChance = info.id === "elite" ? 0.7 : 0.25;
      const kind = dress.nextFloat01() < crystalChance ? "crystal_vein" : "iron_vein";
      const pos = jitter(info.center, 5, ROOM_HALF - 2);
      resourceNodes.push({ id: `node-${room.index}-${i}`, kind, x: pos.x, z: pos.z });
    }
  }

  // Fishing spots: a SEPARATE pass appended AFTER the mining loop so its dress
  // draws come last and never shift existing seeds' spawn/prop/mining layout.
  // A guaranteed town pond keeps the fishing loop reachable from spawn; combat
  // rooms get an occasional deeper spot (elite rooms fish rarer stock).
  resourceNodes.push({ id: "fish-town", kind: "fishing_spot", x: startCenter.x - 5, z: startCenter.z - 4 });
  for (const room of graph.rooms) {
    if (room.kind !== "combat") continue;
    if (dress.nextFloat01() >= 0.5) continue;
    const info = roomInfo.get(room.index)!;
    const kind = info.id === "elite" ? "deep_fishing_spot" : "fishing_spot";
    const pos = jitter(info.center, 5, ROOM_HALF - 2);
    resourceNodes.push({ id: `fish-${room.index}`, kind, x: pos.x, z: pos.z });
  }

  // Market stall + cooking station: fixed offsets inside the start ("market")
  // room (no rng draws), clear of the player spawn, the fountain, and each other.
  const marketStall: Vec2 = { x: startCenter.x + 4, z: startCenter.z + 3 };
  const cookingStation: Vec2 = { x: startCenter.x - 4, z: startCenter.z + 3 };

  return {
    tileSize: TILE,
    rooms,
    walkable,
    collision: walkable,
    floorTiles: [],
    playerSpawn: startCenter,
    normalSpawns,
    eliteSpawns,
    enemySpawns: normalSpawns,
    waveSpawns: [...normalSpawns, ...eliteSpawns],
    bossPortal: bossCenter,
    props,
    visualPlacements: [...floorPlacements, ...propPlacements],
    resourceNodes,
    marketStall,
    cookingStation,
  };
}
