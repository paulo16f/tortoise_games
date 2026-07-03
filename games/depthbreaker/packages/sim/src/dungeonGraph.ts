// Dungeon layout contract (GAME_MATH_SPEC.md §6). Mirrored by DungeonGraphGenerator.cs.
//
// Seeded random walk on a 2D grid producing a TREE (each room connects only to
// the room it grew from), which guarantees connectivity and dead-ends. Boss is
// the BFS-farthest room from start; treasure is a seeded pick among remaining
// dead-ends. The zone server generates this authoritatively; clients rebuild
// the same graph from the seed for geometry only.

import { DeterministicRng, deriveStreamSeed, RngStream } from "./rng.js";

export type RoomKind = "start" | "combat" | "boss" | "treasure";

export interface Room {
  index: number;
  x: number;
  y: number;
  kind: RoomKind;
  /** Indices of connected rooms (doors), in creation order. */
  doors: number[];
}

export interface DungeonGraph {
  rooms: Room[];
  bossIndex: number;
  /** -1 when no eligible dead-end exists. */
  treasureIndex: number;
}

/** Normative direction order: N, E, S, W. */
const DIRS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const;

export function generateDungeon(rng: DeterministicRng, roomCount: number): DungeonGraph {
  if (roomCount < 2) throw new RangeError("roomCount must be >= 2");

  const rooms: Room[] = [{ index: 0, x: 0, y: 0, kind: "start", doors: [] }];
  const occupied = new Map<string, number>([["0,0", 0]]);

  while (rooms.length < roomCount) {
    const parent = rooms[rng.nextUint32() % rooms.length]!;
    const dir = DIRS[rng.nextUint32() % 4]!;
    const x = parent.x + dir[0];
    const y = parent.y + dir[1];
    const key = `${x},${y}`;
    if (occupied.has(key)) continue;

    const room: Room = { index: rooms.length, x, y, kind: "combat", doors: [parent.index] };
    parent.doors.push(room.index);
    occupied.set(key, room.index);
    rooms.push(room);
  }

  // BFS from start; neighbors visited in ascending index order (doors are
  // creation-ordered, which is ascending for children; parent link sorts first).
  const distance = new Array<number>(rooms.length).fill(-1);
  distance[0] = 0;
  const queue = [0];
  while (queue.length > 0) {
    const at = queue.shift()!;
    const neighbors = [...rooms[at]!.doors].sort((a, b) => a - b);
    for (const next of neighbors) {
      if (distance[next] === -1) {
        distance[next] = distance[at]! + 1;
        queue.push(next);
      }
    }
  }

  let bossIndex = 1;
  for (let i = 1; i < rooms.length; i++) {
    if (distance[i]! > distance[bossIndex]!) bossIndex = i; // tie keeps lowest index
  }
  rooms[bossIndex]!.kind = "boss";

  const deadEnds = rooms.filter(
    (r) => r.doors.length === 1 && r.index !== 0 && r.index !== bossIndex,
  );
  let treasureIndex = -1;
  if (deadEnds.length > 0) {
    // Only consumes RNG when candidates exist.
    treasureIndex = deadEnds[rng.nextUint32() % deadEnds.length]!.index;
    rooms[treasureIndex]!.kind = "treasure";
  }

  return { rooms, bossIndex, treasureIndex };
}

/** Convenience: generate from a run seed using the Layout substream. */
export function generateDungeonFromSeed(seed32: number, roomCount: number): DungeonGraph {
  const rng = new DeterministicRng(deriveStreamSeed(seed32, RngStream.Layout));
  return generateDungeon(rng, roomCount);
}

/** Room count by dungeon depth (floor number, 1-based). */
export function roomCountForDepth(depth: number): number {
  return 8 + 2 * Math.max(0, depth - 1);
}
