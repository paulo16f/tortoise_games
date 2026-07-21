import { useMemo } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import type { Ray } from "three";
import { buildDungeon, groundHeightAt, isDungeonWalkable, nearestDungeonWalkablePoint, type DungeonMapDefinition } from "@depthbreaker/protocol";
import { zoneStore } from "../../net/room";
import { useZoneState } from "../../net/useZone";
import { setClickDestination, controlState } from "../input/controls";
import { localPlayerPos } from "../entityRefs";

// Extra margin so the click plane covers the water RING around the island —
// clicking there fishes (the server validates shore + reach).
const WATER_MARGIN = 60;

function mapBounds(dungeon: DungeonMapDefinition) {
  const minX = Math.min(...dungeon.walkable.map((rect) => rect.minX));
  const maxX = Math.max(...dungeon.walkable.map((rect) => rect.maxX));
  const minZ = Math.min(...dungeon.walkable.map((rect) => rect.minZ));
  const maxZ = Math.max(...dungeon.walkable.map((rect) => rect.maxZ));
  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX + WATER_MARGIN * 2,
    depth: maxZ - minZ + WATER_MARGIN * 2,
  };
}

/** Where the pointer ray meets the REAL terrain (grid heights), not a flat
 *  plane. A flat plane at one height mis-projects every click on terrain at a
 *  different height by ~0.6x the height difference (the old "everything is
 *  slightly off / invisible wall" bug). Coarse march + bisection refine. */
function pickTerrainPoint(ray: Ray, dungeon: DungeonMapDefinition): { x: number; z: number } | null {
  const o = ray.origin, d = ray.direction;
  if (d.y >= -0.02) return null; // looking at the sky — no ground hit
  const above = (t: number) => {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    return y - groundHeightAt(x, z, dungeon);
  };
  // Step so each hop drops ~0.5u vertically; the camera sits ~10-20u up, so
  // this is ~40-80 cheap samples worst case.
  const dt = 0.5 / -d.y;
  const maxT = (o.y + 40) / -d.y; // far past any terrain (min height ~0)
  let tPrev = 0, aPrev = above(0);
  for (let t = dt; t <= maxT; t += dt) {
    const a = above(t);
    if (aPrev > 0 && a <= 0) {
      // Bisect the crossing for a precise contact point.
      let lo = tPrev, hi = t;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid; else hi = mid;
      }
      const tc = (lo + hi) / 2;
      return { x: o.x + d.x * tc, z: o.z + d.z * tc };
    }
    tPrev = t; aPrev = a;
  }
  return null;
}

export function DungeonClickPlane() {
  const snap = useZoneState();
  const dungeon = useMemo(() => buildDungeon(snap.seed, snap.depth), [snap.seed, snap.depth]);
  const bounds = useMemo(() => mapBounds(dungeon), [dungeon]);

  const handleGroundClick = (ev: ThreeEvent<PointerEvent>) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    const targetId = zoneStore.state?.players.get(zoneStore.selfId)?.targetId ?? "";
    if (targetId) zoneStore.sendTarget("");
    const hit = pickTerrainPoint(ev.ray, dungeon) ?? { x: ev.point.x, z: ev.point.z };
    // Clicking open water (off the island) casts a fishing line — the server
    // validates the player is on the shore within reach. Land clicks move.
    if (!isDungeonWalkable(hit.x, hit.z, 0.3, dungeon)) {
      zoneStore.sendFishHere(hit.x, hit.z);
      return;
    }
    const point = nearestDungeonWalkablePoint(hit.x, hit.z, 0.45, dungeon);
    setClickDestination(point.x, point.z);
    // Don't wait for the next 20 Hz tick — tell the server NOW (up to 50ms
    // sooner) while the local prediction starts moving this same frame.
    const dx = point.x - localPlayerPos.x;
    const dz = point.z - localPlayerPos.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.35) zoneStore.sendInput({ seq: -1, moveX: dx / len, moveZ: dz / len, yaw: controlState.orbit.yaw });
  };

  // The plane only CATCHES pointer events (the terrain point comes from the
  // ray-march above, not from where the ray meets this flat plane).
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[bounds.centerX, 0, bounds.centerZ]}
      onPointerDown={handleGroundClick}
    >
      <planeGeometry args={[bounds.width, bounds.depth]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
