// Shared smoke-test navigation: BFS over the SAME deterministic dungeon the
// server simulates (buildDungeon(seed, depth) — proven by the depth-loop
// probe), so headless players can cross the maze instead of beelining into
// walls. Every walking smoke delegates here; when the level design changes,
// navigation keeps working because the map is rebuilt from the room's seed.
// Requires tsx (the protocol package resolves to TS source).

import { buildDungeon, isDungeonWalkable } from "@depthbreaker/protocol";

const GRID = 0.5;
const HALF = 200; // grid cells each side of origin (covers ±100 world units)
const RADIUS = 0.3;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** One navigator per room; caches the dungeon + walkability lookups. */
export function makeNav(room) {
  const dungeon = buildDungeon(room.state.seed, room.state.depth);
  const walkCache = new Map();
  const key = (ix, iz) => ix + "," + iz;
  const walkable = (ix, iz) => {
    const k = key(ix, iz);
    if (!walkCache.has(k)) walkCache.set(k, isDungeonWalkable(ix * GRID, iz * GRID, RADIUS, dungeon));
    return walkCache.get(k);
  };

  function bfsPath(fromX, fromZ, toX, toZ) {
    const s = [Math.round(fromX / GRID), Math.round(fromZ / GRID)];
    const t = [Math.round(toX / GRID), Math.round(toZ / GRID)];
    const prev = new Map([[key(...s), null]]);
    const q = [s];
    while (q.length) {
      const [x, z] = q.shift();
      if (Math.abs(x - t[0]) + Math.abs(z - t[1]) <= 3) {
        const path = [];
        let cur = key(x, z);
        while (cur) {
          const [cx, cz] = cur.split(",").map(Number);
          path.push({ x: cx * GRID, z: cz * GRID });
          cur = prev.get(cur);
        }
        return path.reverse();
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (Math.abs(nx) > HALF || Math.abs(nz) > HALF) continue;
        const k = key(nx, nz);
        if (prev.has(k) || !walkable(nx, nz)) continue;
        prev.set(k, key(x, z));
        q.push([nx, nz]);
      }
    }
    return null;
  }

  let seq = 50_000; // own input-seq range; never collides with test inputs

  /**
   * Walk `self` until within `stopDist` of the (possibly moving) target.
   * `getPos()` returns {x, z} or null (target gone). BFS path, replanned when
   * the target drifts; straight-line fallback when no path exists.
   * Resolves true when arrived, false on timeout/target-gone/death.
   */
  async function navWalk(self, getPos, stopDist, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const tgt = getPos();
      if (!tgt || !self.alive) { stop(); return false; }
      const d0 = Math.hypot(tgt.x - self.x, tgt.z - self.z);
      if (d0 <= stopDist) { stop(); return true; }
      const path = bfsPath(self.x, self.z, tgt.x, tgt.z) ?? [{ x: tgt.x, z: tgt.z }];
      const plannedFor = { x: tgt.x, z: tgt.z };
      for (const wp of path) {
        let stuck = 0, lastD = Infinity;
        while (Date.now() < deadline) {
          const t2 = getPos();
          if (!t2 || !self.alive) { stop(); return false; }
          if (Math.hypot(t2.x - self.x, t2.z - self.z) <= stopDist) { stop(); return true; }
          // Replan when the target has moved well away from the planned goal.
          if (Math.hypot(t2.x - plannedFor.x, t2.z - plannedFor.z) > 6) break;
          const dx = wp.x - self.x, dz = wp.z - self.z, d = Math.hypot(dx, dz);
          if (d < 0.7) break;
          if (d > lastD - 0.02) { if (++stuck > 24) break; } else stuck = 0;
          lastD = d;
          room.send("input", { seq: seq++, moveX: dx / d, moveZ: dz / d, yaw: Math.atan2(dx, dz) });
          await wait(50);
        }
        const t3 = getPos();
        if (!t3 || Math.hypot(t3.x - plannedFor.x, t3.z - plannedFor.z) > 6) break; // replan outer
      }
      // Final approach: BFS waypoints keep 0.3u clearance, but targets sitting
      // inside a prop's collision ring (the market stall) need a direct push —
      // the server clamps illegal moves, so this can only get closer.
      for (let i = 0; i < 40 && Date.now() < deadline; i++) {
        const t4 = getPos();
        if (!t4 || !self.alive) { stop(); return false; }
        const dx = t4.x - self.x, dz = t4.z - self.z, d = Math.hypot(dx, dz);
        if (d <= stopDist) { stop(); return true; }
        room.send("input", { seq: seq++, moveX: dx / d, moveZ: dz / d, yaw: Math.atan2(dx, dz) });
        await wait(50);
      }
    }
    stop();
    const t = getPos();
    return !!t && Math.hypot(t.x - self.x, t.z - self.z) <= stopDist;

    function stop() {
      room.send("input", { seq: seq++, moveX: 0, moveZ: 0, yaw: 0 });
    }
  }

  /** Walk near a live enemy by id. */
  const walkNearEnemy = (self, enemyId, stopDist, timeoutMs) =>
    navWalk(
      self,
      () => {
        const e = room.state.enemies.get(enemyId);
        return e && e.alive ? { x: e.x, z: e.z } : null;
      },
      stopDist,
      timeoutMs,
    );

  /** Walk near a fixed world point. */
  const walkToPoint = (self, x, z, stopDist, timeoutMs) => navWalk(self, () => ({ x, z }), stopDist, timeoutMs);

  return { dungeon, navWalk, walkNearEnemy, walkToPoint };
}
