import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { buildDungeon, type DungeonVisualPlacement } from "@depthbreaker/protocol";
import { SkeletonUtils } from "three-stdlib";
import type { Color, Group, Material, Object3D } from "three";
import { useZoneState } from "../../net/useZone";
import { DUNGEON_ASSETS, DUNGEON_ASSET_META } from "./syntyDungeonAssets";

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

  return (
    <group>
      {dungeon.visualPlacements.map((placement, index) => (
        <RuntimeDungeonModel key={`${placement.asset}-${placement.x}-${placement.z}-${index}`} placement={placement} />
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
