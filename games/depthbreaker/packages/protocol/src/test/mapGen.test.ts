import { describe, it, expect } from "vitest";
import { roomCountForDepth } from "@depthbreaker/sim";
import { buildDungeon } from "../mapGen.js";
import { isDungeonWalkable, isPointInRect, nearestDungeonWalkablePoint, type Rect, type Vec2 } from "../map.js";

const SEEDS = [1, 555, 8675309, 4294967295];

function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return outer.minX <= inner.minX && outer.maxX >= inner.maxX && outer.minZ <= inner.minZ && outer.maxZ >= inner.maxZ;
}

/** BFS over the walkable rects treated as nodes, connected when they overlap. */
function rectsConnected(rects: Rect[]): boolean {
  if (rects.length === 0) return true;
  const overlaps = (a: Rect, b: Rect): boolean =>
    a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (let i = 0; i < rects.length; i++) {
      if (seen.has(i)) continue;
      if (overlaps(rects[at]!, rects[i]!)) {
        seen.add(i);
        queue.push(i);
      }
    }
  }
  return seen.size === rects.length;
}

describe("buildDungeon", () => {
  it("is deterministic in (seed, depth)", () => {
    for (const seed of SEEDS) {
      expect(buildDungeon(seed, 1)).toEqual(buildDungeon(seed, 1));
    }
  });

  it("is seed-sensitive", () => {
    expect(buildDungeon(555, 1)).not.toEqual(buildDungeon(556, 1));
  });

  it("produces one room per graph room and the right count for depth", () => {
    for (const depth of [1, 2, 3]) {
      const map = buildDungeon(1234, depth);
      expect(map.rooms.length).toBe(roomCountForDepth(depth));
    }
  });

  it("places the start room, player spawn, boss portal, and all enemy spawns on walkable ground", () => {
    for (const seed of SEEDS) {
      const map = buildDungeon(seed, 2);
      const walkablePoints: Vec2[] = [map.playerSpawn, map.bossPortal, ...map.normalSpawns, ...map.eliteSpawns];
      for (const p of walkablePoints) {
        expect(isDungeonWalkable(p.x, p.z, 0.45, map)).toBe(true);
      }
    }
  });

  it("keeps every room rect inside the walkable set and the whole map connected", () => {
    for (const seed of SEEDS) {
      const map = buildDungeon(seed, 2);
      for (const room of map.rooms) {
        expect(map.walkable.some((rect) => rectContainsRect(rect, room.rect))).toBe(true);
      }
      expect(rectsConnected(map.walkable)).toBe(true);
      // collision is the same set as walkable (as the runtime relies on).
      expect(map.collision).toBe(map.walkable);
    }
  });

  it("has a market start room and a boss room, and props only reference non-floor assets", () => {
    const map = buildDungeon(42, 2);
    expect(map.rooms[0]!.id).toBe("market");
    expect(map.rooms.some((r) => r.id === "boss")).toBe(true);
    for (const prop of map.props) {
      expect(prop.asset).not.toBe("floor");
      expect(isPointInRect(prop.x, prop.z, { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 })).toBe(true);
    }
  });

  it("places resource nodes on walkable ground, deterministically", () => {
    for (const seed of SEEDS) {
      const map = buildDungeon(seed, 2);
      expect(map.resourceNodes.length).toBeGreaterThan(0);
      for (const node of map.resourceNodes) {
        expect(["iron_vein", "crystal_vein", "fishing_spot", "deep_fishing_spot"]).toContain(node.kind);
        expect(isDungeonWalkable(node.x, node.z, 0.45, map)).toBe(true);
        // Only the guaranteed town pond sits in the start room; mining veins and
        // combat fishing spots are always out in the dungeon.
        const inStart = isPointInRect(node.x, node.z, map.rooms[0]!.rect);
        expect(inStart).toBe(node.id === "fish-town");
      }
      // A reachable town fishing pond always exists.
      expect(map.resourceNodes.some((n) => n.id === "fish-town" && n.kind === "fishing_spot")).toBe(true);
      const ids = map.resourceNodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(buildDungeon(seed, 2).resourceNodes).toEqual(map.resourceNodes);
    }
  });

  it("puts the cooking station inside the start room, clear of spawn and stall", () => {
    for (const seed of SEEDS) {
      const map = buildDungeon(seed, 2);
      expect(isPointInRect(map.cookingStation.x, map.cookingStation.z, map.rooms[0]!.rect)).toBe(true);
      expect(Math.hypot(map.cookingStation.x - map.playerSpawn.x, map.cookingStation.z - map.playerSpawn.z)).toBeGreaterThan(2);
      expect(Math.hypot(map.cookingStation.x - map.marketStall.x, map.cookingStation.z - map.marketStall.z)).toBeGreaterThan(2);
    }
  });

  it("puts the market stall inside the start room, clear of the player spawn", () => {
    for (const seed of SEEDS) {
      const map = buildDungeon(seed, 2);
      expect(isPointInRect(map.marketStall.x, map.marketStall.z, map.rooms[0]!.rect)).toBe(true);
      const d = Math.hypot(map.marketStall.x - map.playerSpawn.x, map.marketStall.z - map.playerSpawn.z);
      expect(d).toBeGreaterThan(2);
    }
  });

  it("projects off-map click points to the nearest walkable point", () => {
    const rect: Rect = { minX: -10, maxX: 10, minZ: -5, maxZ: 5 };
    const map = { ...buildDungeon(42, 1), collision: [rect], playerSpawn: { x: 0, z: 0 } };
    const projected = nearestDungeonWalkablePoint(-25, -25, 0.45, map);
    expect(isDungeonWalkable(projected.x, projected.z, 0.45, map)).toBe(true);
    expect(projected.x).toBeCloseTo(rect.minX + 0.45);
    expect(projected.z).toBeCloseTo(rect.minZ + 0.45);
  });
});
