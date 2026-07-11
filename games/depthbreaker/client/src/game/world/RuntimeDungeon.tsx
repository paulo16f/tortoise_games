import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { buildDungeon, type DungeonMapDefinition, type DungeonVisualPlacement } from "@depthbreaker/protocol";
import { SkeletonUtils } from "three-stdlib";
import { Matrix4, Quaternion, Vector3 as V3 } from "three";
import type { Color, Group, InstancedMesh, Material, Object3D } from "three";
import { useZoneState } from "../../net/useZone";
import { localPlayerPos } from "../entityRefs";
import { DUNGEON_ASSETS, DUNGEON_ASSET_META } from "./syntyDungeonAssets";

// Distance culling: a room's models render only while the player is within
// SHOW_RADIUS of the room center, and hide past HIDE_RADIUS (hysteresis avoids
// flicker at the boundary). Rooms are ~20u wide on a ~30u grid, so this keeps
// the current room + neighbors; Scene's fog fades the rest so the cull
// boundary isn't visible. Toggling group.visible skips the whole subtree for
// both the main AND shadow passes — the real CPU/GPU saving.
const SHOW_RADIUS = 52;
const HIDE_RADIUS = 70;

// Perimeter walls: the dungeon's collision is "negative space" (you can only
// walk on floor rects), which used to read as invisible walls at floor edges.
// These instanced boxes line every floor-tile edge that has no neighboring
// tile, so the walkable boundary is visible. One InstancedMesh = one draw call
// for the whole map; the server's collision is untouched (visual only).
const WALL_HEIGHT = 2.2;
const WALL_THICKNESS = 0.6;

function placementScale(placement: DungeonVisualPlacement): number | [number, number, number] {
  const metaScale = DUNGEON_ASSET_META[placement.asset]?.visualScale ?? 1;
  const scale = placement.scale ?? 1;
  if (Array.isArray(scale)) return [scale[0] * metaScale, scale[1] * metaScale, scale[2] * metaScale];
  return scale * metaScale;
}

function polishMaterial(material: Material, tint: string): void {
  const std = material as Material & { color?: Color; roughness?: number; metalness?: number };
  std.color?.set(tint);
  // Push floors toward a matte non-metal so the new AO/IBL/directional lighting
  // reads on them instead of a flat unlit tint.
  if (typeof std.roughness === "number") std.roughness = 0.92;
  if (typeof std.metalness === "number") std.metalness = 0;
}

function cloneRuntimeScene(scene: Group, tint?: string): Group {
  const clone = SkeletonUtils.clone(scene) as Group;
  clone.traverse((object) => {
    object.castShadow = true;
    object.receiveShadow = true;
    const mesh = object as Object3D & { material?: Material | Material[] };
    if (!mesh.material || !tint) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => {
        const next = material.clone();
        polishMaterial(next, tint);
        return next;
      });
      return;
    }
    const next = mesh.material.clone();
    polishMaterial(next, tint);
    mesh.material = next;
  });
  return clone;
}

function RuntimeDungeonModel({ placement }: { placement: DungeonVisualPlacement }) {
  const url = DUNGEON_ASSETS[placement.asset];
  const meta = DUNGEON_ASSET_META[placement.asset];
  const { scene } = useGLTF(url);
  const clone = useMemo(() => cloneRuntimeScene(scene, placement.tint), [scene, placement.tint]);
  const y = (placement.y ?? 0) + (meta?.yOffset ?? 0);

  return (
    <primitive
      object={clone}
      position={[placement.x, y, placement.z]}
      rotation={[0, placement.yaw ?? 0, 0]}
      scale={placementScale(placement)}
    />
  );
}

/** Boundary walls for the whole map as a single instanced mesh. */
function DungeonWalls({ dungeon }: { dungeon: DungeonMapDefinition }) {
  const ref = useRef<InstancedMesh>(null);

  const segments = useMemo(() => {
    const tile = dungeon.tileSize;
    const floors = dungeon.visualPlacements.filter((p) => p.asset === "floor");
    const key = (x: number, z: number) => `${x.toFixed(2)}:${z.toFixed(2)}`;
    const have = new Set(floors.map((p) => key(p.x, p.z)));
    const out: { x: number; z: number; yaw: number }[] = [];
    for (const p of floors) {
      // A wall segment on each tile edge with no neighboring floor tile,
      // pushed half a thickness outward so its inner face sits flush with the
      // floor edge (where the server's collision actually stops you).
      if (!have.has(key(p.x + tile, p.z))) out.push({ x: p.x + tile / 2 + WALL_THICKNESS / 2, z: p.z, yaw: Math.PI / 2 });
      if (!have.has(key(p.x - tile, p.z))) out.push({ x: p.x - tile / 2 - WALL_THICKNESS / 2, z: p.z, yaw: Math.PI / 2 });
      if (!have.has(key(p.x, p.z + tile))) out.push({ x: p.x, z: p.z + tile / 2 + WALL_THICKNESS / 2, yaw: 0 });
      if (!have.has(key(p.x, p.z - tile))) out.push({ x: p.x, z: p.z - tile / 2 - WALL_THICKNESS / 2, yaw: 0 });
    }
    return out;
  }, [dungeon]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new V3(0, 1, 0);
    const pos = new V3();
    const scale = new V3(1, 1, 1);
    segments.forEach((seg, i) => {
      q.setFromAxisAngle(up, seg.yaw);
      pos.set(seg.x, WALL_HEIGHT / 2, seg.z);
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [segments]);

  if (segments.length === 0) return null;
  return (
    // Instance count is fixed at construction — key remounts on map change.
    // frustumCulled off: instanced bounds don't cover the placed instances.
    <instancedMesh
      key={`walls-${segments.length}`}
      ref={ref}
      args={[undefined, undefined, segments.length]}
      frustumCulled={false}
      castShadow
      receiveShadow
    >
      {/* Slightly longer than a tile so perpendicular segments close corners. */}
      <boxGeometry args={[dungeon.tileSize + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS]} />
      <meshStandardMaterial color="#4a5058" roughness={0.9} metalness={0} />
    </instancedMesh>
  );
}

/** One room's worth of dungeon models, culled as a unit by distance to the player. */
function RoomGroup({ center, placements }: { center: { x: number; z: number }; placements: DungeonVisualPlacement[] }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const d = Math.hypot(localPlayerPos.x - center.x, localPlayerPos.z - center.z);
    // Hysteresis: only flip once past the far/near threshold for the current state.
    if (g.visible && d > HIDE_RADIUS) g.visible = false;
    else if (!g.visible && d < SHOW_RADIUS) g.visible = true;
  });
  return (
    <group ref={ref}>
      {placements.map((placement, index) => (
        <RuntimeDungeonModel key={`${placement.asset}-${placement.x}-${placement.z}-${index}`} placement={placement} />
      ))}
    </group>
  );
}

function SpawnMarker({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.12, z]} receiveShadow>
      <ringGeometry args={[0.65, 0.9, 24]} />
      <meshStandardMaterial color={color} roughness={0.8} />
    </mesh>
  );
}

export function RuntimeDungeon() {
  // Rebuild the exact map the server generated from the synced run seed - a pure
  // deterministic function, so client and server geometry are identical.
  const snap = useZoneState();
  const dungeon = useMemo(() => buildDungeon(snap.seed, snap.depth), [snap.seed, snap.depth]);

  // Bucket every placement into its nearest room so whole rooms cull as a unit.
  // Corridor tiles (inside no room rect) fall to their nearest room center,
  // which is good enough for visibility grouping.
  const roomBuckets = useMemo(() => {
    const centers = dungeon.rooms.map((r) => ({
      x: (r.rect.minX + r.rect.maxX) / 2,
      z: (r.rect.minZ + r.rect.maxZ) / 2,
    }));
    const buckets: DungeonVisualPlacement[][] = centers.map(() => []);
    if (centers.length === 0) return { centers, buckets };
    for (const p of dungeon.visualPlacements) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const d = (centers[i].x - p.x) ** 2 + (centers[i].z - p.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      buckets[best].push(p);
    }
    return { centers, buckets };
  }, [dungeon]);

  return (
    <group>
      <DungeonWalls dungeon={dungeon} />
      {roomBuckets.centers.map((center, ri) => (
        <RoomGroup key={`room-${ri}`} center={center} placements={roomBuckets.buckets[ri]} />
      ))}
      {dungeon.normalSpawns.slice(0, 3).map((spawn, index) => (
        <SpawnMarker key={`normal-spawn-${index}`} x={spawn.x} z={spawn.z} color="#8fbf75" />
      ))}
      {dungeon.eliteSpawns.slice(0, 2).map((spawn, index) => (
        <SpawnMarker key={`elite-spawn-${index}`} x={spawn.x} z={spawn.z} color="#b28cff" />
      ))}
      <SpawnMarker x={dungeon.bossPortal.x} z={dungeon.bossPortal.z} color="#d27a7a" />
    </group>
  );
}
