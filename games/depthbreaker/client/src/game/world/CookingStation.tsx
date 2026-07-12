// The cooking station in the start ("market") room. Static — its position comes
// from the same deterministic buildDungeon the server range-checks against.
// Clicking walks you over (if far) or opens the cooking panel. A campfire GLB is
// the placeholder for the Dungeon Realms cooking set. Mirrors MarketStall.tsx.

import { useMemo, useRef } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import { Billboard, Text, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import type { Group } from "three";
import { buildDungeon } from "@depthbreaker/protocol";
import { useZoneState } from "../../net/useZone";
import { localPlayerPos } from "../entityRefs";
import { setClickDestination } from "../input/controls";
import { setGameCursor } from "../cursors";
import { toggleCooking } from "../../ui/CookingPanel";
import { DUNGEON_ASSETS } from "./syntyDungeonAssets";

const OPEN_RANGE = 5; // client-side convenience; server enforces 6 on crafts

export function CookingStation() {
  const snap = useZoneState();
  const station = useMemo(() => buildDungeon(snap.seed, snap.depth).cookingStation, [snap.seed, snap.depth]);
  const campfire = useGLTF(DUNGEON_ASSETS.campfire);
  const group = useRef<Group>(null);

  const campfireClone = useMemo(() => {
    const c = SkeletonUtils.clone(campfire.scene) as Group;
    c.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return c;
  }, [campfire.scene]);

  const handleClick = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    const d = Math.hypot(localPlayerPos.x - station.x, localPlayerPos.z - station.z);
    if (d > OPEN_RANGE) {
      setClickDestination(station.x, station.z);
      return;
    }
    toggleCooking();
  };
  const handleOver = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    setGameCursor("trade");
  };
  const handleOut = () => {
    setGameCursor("default");
  };

  return (
    <group ref={group} position={[station.x, 0, station.z]}>
      <primitive object={campfireClone} scale={3.2} />
      {/* Warm firelight so the station reads at a glance. */}
      <pointLight position={[0, 1.1, 0]} color="#ff9d5c" intensity={5} distance={7} decay={2} />
      <Billboard position={[0, 2.2, 0]}>
        <Text fontSize={0.42} color="#fb923c" outlineWidth={0.02} outlineColor="#000000">
          Cooking
        </Text>
      </Billboard>
      <mesh position={[0, 0.9, 0]} onPointerDown={handleClick} onPointerOver={handleOver} onPointerOut={handleOut}>
        <capsuleGeometry args={[1.1, 1.0, 4, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
