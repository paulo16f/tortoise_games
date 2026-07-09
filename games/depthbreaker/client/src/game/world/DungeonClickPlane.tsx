import { useMemo } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import { buildDungeon, nearestDungeonWalkablePoint, type DungeonMapDefinition } from "@depthbreaker/protocol";
import { zoneStore } from "../../net/room";
import { useZoneState } from "../../net/useZone";
import { setClickDestination } from "../input/controls";

function mapBounds(dungeon: DungeonMapDefinition) {
  const minX = Math.min(...dungeon.walkable.map((rect) => rect.minX));
  const maxX = Math.max(...dungeon.walkable.map((rect) => rect.maxX));
  const minZ = Math.min(...dungeon.walkable.map((rect) => rect.minZ));
  const maxZ = Math.max(...dungeon.walkable.map((rect) => rect.maxZ));
  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: maxX - minX,
    depth: maxZ - minZ,
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
    const point = nearestDungeonWalkablePoint(ev.point.x, ev.point.z, 0.45, dungeon);
    setClickDestination(point.x, point.z);
  };

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[bounds.centerX, 0.03, bounds.centerZ]}
      onPointerDown={handleGroundClick}
    >
      <planeGeometry args={[bounds.width, bounds.depth]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
