import { buildDungeon, DEFAULT_DEPTH, DEFAULT_SEED } from "./mapGen.js";

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

export type DungeonRoomId = "market" | "normal" | "elite" | "boss";
export type DungeonVisualAssetId =
  | "floor"
  | "bones"
  | "crystal"
  | "crystal_alt"
  | "mushroom"
  | "mushroom_alt"
  | "rocks"
  | "skull"
  | "stairs"
  | "chest_closed"
  | "chest_open"
  | "campfire"
  | "crate";

export interface DungeonProp {
  asset: Exclude<DungeonVisualAssetId, "floor">;
  x: number;
  z: number;
  yaw?: number;
}

export interface DungeonRoom {
  id: DungeonRoomId;
  rect: Rect;
}

export interface DungeonVisualPlacement {
  asset: DungeonVisualAssetId;
  x: number;
  z: number;
  y?: number;
  yaw?: number;
  scale?: number | [number, number, number];
  tint?: string;
}

export type ResourceNodeKind = "iron_vein" | "crystal_vein";

/** A gatherable mining node (deterministic per seed, like enemy spawns). */
export interface ResourceNodeDef {
  id: string;
  kind: ResourceNodeKind;
  x: number;
  z: number;
}

export interface DungeonMapDefinition {
  tileSize: number;
  rooms: DungeonRoom[];
  walkable: Rect[];
  collision: Rect[];
  floorTiles: Vec2[];
  playerSpawn: Vec2;
  normalSpawns: Vec2[];
  eliteSpawns: Vec2[];
  enemySpawns: Vec2[];
  waveSpawns: Vec2[];
  bossPortal: Vec2;
  props: DungeonProp[];
  visualPlacements: DungeonVisualPlacement[];
  /** Mining nodes; the zone server spawns synced ResourceNodeState from these. */
  resourceNodes: ResourceNodeDef[];
  /** Market stall location, inside the start ("market") room. */
  marketStall: Vec2;
}

// The dungeon is generated from the seeded room graph (see mapGen.ts). This
// module-level instance is only a fallback/default for the exported helpers'
// `map =` parameters - real runs build their own per-seed map on both the
// server (ZoneRoom) and the client (RuntimeDungeon), each from the synced seed.
export const DEPTHBREAKER_DUNGEON: DungeonMapDefinition = buildDungeon(DEFAULT_SEED, DEFAULT_DEPTH);

export function isPointInRect(x: number, z: number, rect: Rect, radius = 0): boolean {
  return x >= rect.minX + radius && x <= rect.maxX - radius && z >= rect.minZ + radius && z <= rect.maxZ - radius;
}

export function isDungeonWalkable(x: number, z: number, radius = 0.45, map = DEPTHBREAKER_DUNGEON): boolean {
  return map.collision.some((rect) => isPointInRect(x, z, rect, radius));
}

export function nearestDungeonWalkablePoint(x: number, z: number, radius = 0.45, map = DEPTHBREAKER_DUNGEON): Vec2 {
  if (isDungeonWalkable(x, z, radius, map)) return { x, z };

  let best: Vec2 = map.playerSpawn;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const rect of map.collision) {
    const px = Math.min(Math.max(x, rect.minX + radius), rect.maxX - radius);
    const pz = Math.min(Math.max(z, rect.minZ + radius), rect.maxZ - radius);
    const d = Math.hypot(px - x, pz - z);
    if (d < bestDistance) {
      bestDistance = d;
      best = { x: px, z: pz };
    }
  }
  return best;
}

export function nearestDungeonSpawn(index: number, spawns = DEPTHBREAKER_DUNGEON.waveSpawns): Vec2 {
  return spawns[index % spawns.length] ?? DEPTHBREAKER_DUNGEON.playerSpawn;
}
