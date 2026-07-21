import { describe, expect, it } from "vitest";
import {
  generateDungeonFromSeed,
  roomCountForDepth,
  type DungeonGraph,
} from "../dungeonGraph.js";
import { loadVector } from "./helpers/vectors.js";

interface DungeonVectors {
  roomCountForDepth: { depth: number; roomCount: number }[];
  graphs: { seed: number; roomCount: number; graph: DungeonGraph }[];
}

const vectors = loadVector<DungeonVectors>("dungeon_graphs.json");

function assertConnectedTree(graph: DungeonGraph): void {
  const n = graph.rooms.length;
  // Tree invariant: doors are symmetric edges; total undirected edges = n - 1.
  const edges = graph.rooms.reduce((a, r) => a + r.doors.length, 0) / 2;
  expect(edges).toBe(n - 1);
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const at = queue.shift()!;
    for (const next of graph.rooms[at]!.doors) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  expect(seen.size).toBe(n);
}

describe("Dungeon graph (GAME_MATH_SPEC §6)", () => {
  it("replays frozen graphs exactly", () => {
    for (const { seed, roomCount, graph } of vectors.graphs) {
      expect(generateDungeonFromSeed(seed, roomCount)).toEqual(graph);
    }
  });

  it("matches frozen roomCountForDepth", () => {
    for (const { depth, roomCount } of vectors.roomCountForDepth) {
      expect(roomCountForDepth(depth)).toBe(roomCount);
    }
  });

  it("is deterministic and seed-sensitive", () => {
    expect(generateDungeonFromSeed(555, 10)).toEqual(generateDungeonFromSeed(555, 10));
    expect(generateDungeonFromSeed(555, 10)).not.toEqual(generateDungeonFromSeed(556, 10));
  });

  it("always yields a connected tree with valid special rooms", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const graph = generateDungeonFromSeed(seed, 12);
      expect(graph.rooms).toHaveLength(12);
      assertConnectedTree(graph);

      expect(graph.rooms[0]!.kind).toBe("start");
      expect(graph.bossIndex).not.toBe(0);
      expect(graph.rooms[graph.bossIndex]!.kind).toBe("boss");

      if (graph.treasureIndex !== -1) {
        const treasure = graph.rooms[graph.treasureIndex]!;
        expect(treasure.kind).toBe("treasure");
        expect(treasure.doors).toHaveLength(1);
        expect(graph.treasureIndex).not.toBe(graph.bossIndex);
      }

      // Boss is BFS-farthest: no room may be strictly farther.
      const dist = new Map<number, number>([[0, 0]]);
      const queue = [0];
      while (queue.length) {
        const at = queue.shift()!;
        for (const next of graph.rooms[at]!.doors) {
          if (!dist.has(next)) {
            dist.set(next, dist.get(at)! + 1);
            queue.push(next);
          }
        }
      }
      const maxDist = Math.max(...[...dist.values()]);
      expect(dist.get(graph.bossIndex)).toBe(maxDist);
    }
  });

  it("rejects roomCount < 2", () => {
    expect(() => generateDungeonFromSeed(1, 1)).toThrow(RangeError);
  });
});
