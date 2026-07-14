// A gatherable mining node (crystal/iron vein), modeled on Enemy.tsx's
// clickable-hitbox pattern. Position is static (synced once); only `depleted`
// changes. Clicking walks the player over when out of range, then gathers.
// Visuals are the already-approved crystal/rocks GLBs — placeholders for the
// POLYGON Dungeon Realms ore veins.

import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import type { Color, Group, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D } from "three";
import { GATHER_RANGE } from "@depthbreaker/protocol";
import { zoneStore } from "../../net/room";
import { localPlayerPos } from "../entityRefs";
import { setClickDestination } from "../input/controls";
import { setGameCursor } from "../cursors";
import { startCastBar } from "../../ui/CastBar";
import { GATHER_CAST_SECONDS, FISH_CAST_SECONDS } from "@depthbreaker/protocol";
import { DUNGEON_ASSETS } from "./syntyDungeonAssets";
import { groundY } from "./groundMap";
import { spawnImpactBurst } from "../fx/ImpactFx";
import { playGather } from "../fx/sfx";

const GATHER_CLICK_RANGE = 2.8; // client-side convenience; server enforces 3
const RING_IN_RANGE = "#fbbf24";
const RING_OUT_OF_RANGE = "#64748b";
const NODE_STYLE: Record<string, { asset: keyof typeof DUNGEON_ASSETS; tint: string; scale: number; fishing?: boolean }> = {
  crystal_vein: { asset: "crystal_alt", tint: "#7c6fd8", scale: 3.0 },
  iron_vein: { asset: "rocks", tint: "#8a6f52", scale: 2.6 },
  // Fishing spots — blue-tinted placeholder props (real water disc/ripple art
  // lands on asset import). A longer cast distinguishes fishing from mining.
  fishing_spot: { asset: "mushroom", tint: "#38bdf8", scale: 2.4, fishing: true },
  deep_fishing_spot: { asset: "mushroom_alt", tint: "#6366f1", scale: 2.7, fishing: true },
};

function cloneTinted(scene: Group, tint: string, materialsOut: MeshStandardMaterial[]): Group {
  const clone = SkeletonUtils.clone(scene) as Group;
  clone.traverse((object) => {
    object.castShadow = true;
    object.receiveShadow = true;
    const mesh = object as Object3D & { material?: Material | Material[] };
    if (!mesh.material) return;
    const retint = (m: Material) => {
      const next = m.clone() as Material & { color?: Color };
      next.color?.set(tint);
      materialsOut.push(next as MeshStandardMaterial);
      return next;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(retint) : retint(mesh.material);
  });
  return clone;
}

export function ResourceNode({ id }: { id: string }) {
  const group = useRef<Group>(null);
  const modelGroup = useRef<Group>(null);
  const ringMesh = useRef<Mesh>(null);
  const hovered = useRef(false);
  const wasDepleted = useRef(false);
  const node = zoneStore.state?.nodes.get(id);
  const style = NODE_STYLE[node?.kind ?? "iron_vein"] ?? NODE_STYLE.iron_vein;
  const { scene } = useGLTF(DUNGEON_ASSETS[style.asset]);
  const materials = useRef<MeshStandardMaterial[]>([]);
  const clone = useMemo(() => {
    materials.current = [];
    return cloneTinted(scene, style.tint, materials.current);
  }, [scene, style.tint]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const live = zoneStore.state?.nodes.get(id);
    if (!live) {
      g.visible = false;
      return;
    }
    g.visible = true;

    // Gather payoff: on the depleted transition, a burst + clink at the vein.
    if (live.depleted && !wasDepleted.current) {
      wasDepleted.current = true;
      spawnImpactBurst(live.x, 0.9, live.z, { count: 10, color: style.tint, speed: 2.6, size: 0.14, life: 0.45, up: 2.2 });
      playGather();
    } else if (!live.depleted) {
      wasDepleted.current = false;
    }

    // Depleted veins shrink; a cheap but readable state change. Only the model
    // scales — the range ring keeps its world size.
    const m = modelGroup.current;
    if (m) {
      const target = live.depleted ? 0.45 : 1;
      const s = m.scale.x + (target - m.scale.x) * 0.15;
      m.scale.setScalar(s);
    }

    // Gather-range contour: bright amber when the player can mine from here,
    // faint slate when out of range, hidden entirely while depleted.
    const ring = ringMesh.current;
    if (ring) {
      ring.visible = !live.depleted;
      const inRange =
        Math.hypot(localPlayerPos.x - live.x, localPlayerPos.z - live.z) <= GATHER_RANGE;
      const mat = ring.material as MeshBasicMaterial;
      mat.color.set(inRange ? RING_IN_RANGE : RING_OUT_OF_RANGE);
      mat.opacity = inRange ? 0.55 : 0.16;
    }

    // Hover glow + a subtle idle glint so ore draws the eye between gathers.
    const pulse = 0.1 + (Math.sin(performance.now() * 0.002) * 0.5 + 0.5) * 0.16;
    for (const mat of materials.current) {
      if (!mat.emissive) continue;
      if (live.depleted) {
        mat.emissive.set("#000000");
        mat.emissiveIntensity = 0;
      } else if (hovered.current) {
        mat.emissive.set(style.tint);
        mat.emissiveIntensity = 0.6;
      } else {
        mat.emissive.set(style.tint);
        mat.emissiveIntensity = pulse;
      }
    }
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
    if (style.fishing) startCastBar("Fishing…", FISH_CAST_SECONDS);
    else startCastBar("Mining…", GATHER_CAST_SECONDS);
  };
  const handleOver = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    hovered.current = true;
    if (!zoneStore.state?.nodes.get(id)?.depleted) setGameCursor("mine");
  };
  const handleOut = () => {
    hovered.current = false;
    setGameCursor("default");
  };

  return (
    <group ref={group} position={[node.x, groundY(node.x, node.z), node.z]}>
      <group ref={modelGroup}>
        <primitive object={clone} scale={style.scale} />
      </group>
      <mesh ref={ringMesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[GATHER_RANGE - 0.1, GATHER_RANGE, 48]} />
        <meshBasicMaterial color={RING_OUT_OF_RANGE} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.7, 0]} onPointerDown={handleClick} onPointerOver={handleOver} onPointerOut={handleOut}>
        <capsuleGeometry args={[0.8, 0.8, 4, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
