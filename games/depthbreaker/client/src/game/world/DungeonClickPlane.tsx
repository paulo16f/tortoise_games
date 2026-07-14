import { useMemo } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import { buildDungeon, isDungeonWalkable, nearestDungeonWalkablePoint, type DungeonMapDefinition } from "@depthbreaker/protocol";
import { zoneStore } from "../../net/room";
import { useZoneState } from "../../net/useZone";
import { setClickDestination } from "../input/controls";

// Extra margin so the click plane covers the water RING around the island —
// clicking there fishes (the server validates shore + reach).
const WATER_MARGIN = 40;

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

export function DungeonClickPlane() {
  const snap = useZoneState();
  const dungeon = useMemo(() => buildDungeon(snap.seed, snap.depth), [snap.seed, snap.depth]);
  const bounds = useMemo(() => mapBounds(dungeon), [dungeon]);

  const handleGroundClick = (ev: ThreeEvent<PointerEvent>) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    const targetId = zoneStore.state?.players.get(zoneStore.selfId)?.targetId ?? "";
    if (targetId) zoneStore.sendTarget("");
    // Clicking open water (off the island) casts a fishing line — the server
    // validates the player is on the shore within reach. Land clicks move.
    if (!isDungeonWalkable(ev.point.x, ev.point.z, 0.3, dungeon)) {
      zoneStore.sendFishHere(ev.point.x, ev.point.z);
      return;
    }
    const point = nearestDungeonWalkablePoint(ev.point.x, ev.point.z, 0.45, dungeon);
    setClickDestination(point.x, point.z);
  };

  // On the elevated island the click plane sits at the LOCAL PLAYER's ground
  // height, so clicks near them land where the cursor is (a y=0 plane under an
  // angled camera would offset the click by several units per unit of height).
  const planeY = zoneStore.getSnapshot().self?.y ?? 0.03;

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[bounds.centerX, planeY, bounds.centerZ]}
      onPointerDown={handleGroundClick}
    >
      <planeGeometry args={[bounds.width, bounds.depth]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
