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

export interface DungeonProp {
  asset: "barrel" | "barrel_broken" | "rubble" | "rock_small" | "chest";
  x: number;
  z: number;
  yaw?: number;
}

export interface DungeonMapDefinition {
  tileSize: number;
  walkable: Rect[];
  floorTiles: Vec2[];
  playerSpawn: Vec2;
  enemySpawns: Vec2[];
  waveSpawns: Vec2[];
  bossPortal: Vec2;
  props: DungeonProp[];
}

const TILE = 5;

function floorTiles(): Vec2[] {
  const tiles: Vec2[] = [];
  for (let x = -10; x <= 10; x += TILE) {
    for (let z = -10; z <= 10; z += TILE) tiles.push({ x, z });
  }
  for (const z of [15, 20]) tiles.push({ x: 0, z });
  for (let x = -5; x <= 5; x += TILE) {
    for (let z = 25; z <= 30; z += TILE) tiles.push({ x, z });
  }
  return tiles;
}

export const DEPTHBREAKER_DUNGEON: DungeonMapDefinition = {
  tileSize: TILE,
  walkable: [
    { minX: -12.5, maxX: 12.5, minZ: -12.5, maxZ: 12.5 },
    { minX: -2.5, maxX: 2.5, minZ: 12.5, maxZ: 25 },
    { minX: -7.5, maxX: 7.5, minZ: 25, maxZ: 35 },
  ],
  floorTiles: floorTiles(),
  playerSpawn: { x: 0, z: 0 },
  enemySpawns: [
    { x: -8, z: -7 },
    { x: 8, z: -7 },
    { x: -8, z: 7 },
    { x: 8, z: 7 },
  ],
  waveSpawns: [
    { x: -9, z: -9 },
    { x: 9, z: -9 },
    { x: -9, z: 9 },
    { x: 9, z: 9 },
    { x: 0, z: 19 },
    { x: -5, z: 30 },
    { x: 5, z: 30 },
  ],
  bossPortal: { x: 0, z: 30 },
  props: [
    { asset: "barrel", x: -9, z: -8, yaw: 0.8 },
    { asset: "barrel_broken", x: -7.5, z: -7, yaw: -0.4 },
    { asset: "rubble", x: 7.5, z: 7.5, yaw: 1.1 },
    { asset: "rock_small", x: 1.8, z: 18, yaw: 0.2 },
    { asset: "chest", x: -4, z: 31, yaw: Math.PI },
  ],
};

export function isPointInRect(x: number, z: number, rect: Rect, radius = 0): boolean {
  return x >= rect.minX + radius && x <= rect.maxX - radius && z >= rect.minZ + radius && z <= rect.maxZ - radius;
}

export function isDungeonWalkable(x: number, z: number, radius = 0.45, map = DEPTHBREAKER_DUNGEON): boolean {
  return map.walkable.some((rect) => isPointInRect(x, z, rect, radius));
}

export function nearestDungeonSpawn(index: number, spawns = DEPTHBREAKER_DUNGEON.waveSpawns): Vec2 {
  return spawns[index % spawns.length] ?? DEPTHBREAKER_DUNGEON.playerSpawn;
}
