// A gatherable mining node (crystal/iron vein), modeled on Enemy.tsx's
// clickable-hitbox pattern. Position is static (synced once); only `depleted`
// changes. Clicking walks the player over when out of range, then gathers.
// Visuals are the already-approved crystal/rocks GLBs — placeholders for the
// POLYGON Dungeon Realms ore veins.

import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import type { Color, Group, Material, Object3D } from "three";
import { zoneStore } from "../../net/room";
import { localPlayerPos } from "../entityRefs";
import { setClickDestination } from "../input/controls";
import { DUNGEON_ASSETS } from "./syntyDungeonAssets";

const GATHER_CLICK_RANGE = 2.8; // client-side convenience; server enforces 3
const NODE_STYLE: Record<string, { asset: keyof typeof DUNGEON_ASSETS; tint: string; scale: number }> = {
  crystal_vein: { asset: "crystal_alt", tint: "#7c6fd8", scale: 3.0 },
  iron_vein: { asset: "rocks", tint: "#8a6f52", scale: 2.6 },
};

function cloneTinted(scene: Group, tint: string): Group {
  const clone = SkeletonUtils.clone(scene) as Group;
  clone.traverse((object) => {
    object.castShadow = true;
    object.receiveShadow = true;
    const mesh = object as Object3D & { material?: Material | Material[] };
    if (!mesh.material) return;
    const retint = (m: Material) => {
      const next = m.clone() as Material & { color?: Color };
      next.color?.set(tint);
      return next;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(retint) : retint(mesh.material);
  });
  return clone;
}

export function ResourceNode({ id }: { id: string }) {
  const group = useRef<Group>(null);
  const node = zoneStore.state?.nodes.get(id);
  const style = NODE_STYLE[node?.kind ?? "iron_vein"] ?? NODE_STYLE.iron_vein;
  const { scene } = useGLTF(DUNGEON_ASSETS[style.asset]);
  const clone = useMemo(() => cloneTinted(scene, style.tint), [scene, style.tint]);

  // Depleted veins shrink and sink slightly; a cheap but readable state change.
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const live = zoneStore.state?.nodes.get(id);
    if (!live) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const target = live.depleted ? 0.45 : 1;
    const s = g.scale.x + (target - g.scale.x) * 0.15;
    g.scale.setScalar(s);
  });

  if (!node) return null;

  const handleClick = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    const live = zoneStore.state?.nodes.get(id);
    if (!live || live.depleted) return;
    const d = Math.hypot(localPlayerPos.x - live.x, localPlayerPos.z - live.z);
    if (d > GATHER_CLICK_RANGE) {
      setClickDestination(live.x, live.z); // walk over; click again to gather
      return;
    }
    zoneStore.sendGather(id);
  };
  const handleOver = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    if (!zoneStore.state?.nodes.get(id)?.depleted) document.body.style.cursor = "pointer";
  };
  const handleOut = () => {
    document.body.style.cursor = "auto";
  };

  return (
    <group ref={group} position={[node.x, 0, node.z]}>
      <primitive object={clone} scale={style.scale} />
      <mesh position={[0, 0.7, 0]} onPointerDown={handleClick} onPointerOver={handleOver} onPointerOut={handleOut}>
        <capsuleGeometry args={[0.8, 0.8, 4, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
