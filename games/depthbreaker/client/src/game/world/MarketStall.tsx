// The market stall in the start ("market") room. Static — its position comes
// from the same deterministic buildDungeon the server range-checks against.
// Clicking walks you over (if far) or opens the market panel. Crate + open
// chest GLBs are placeholders for the Dungeon Realms merchant set.

import { useMemo, useRef } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import { Billboard, Text, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import type { Group } from "three";
import { buildDungeon, groundHeightAt, USE_OFFICIAL_MAP } from "@depthbreaker/protocol";
import { useZoneState } from "../../net/useZone";
import { localPlayerPos } from "../entityRefs";
import { setClickDestination } from "../input/controls";
import { setGameCursor } from "../cursors";
import { toggleMarket } from "../../ui/MarketPanel";
import { DUNGEON_ASSETS } from "./syntyDungeonAssets";

const OPEN_RANGE = 5; // client-side convenience; server enforces 6 on transactions

export function MarketStall() {
  const snap = useZoneState();
  const stall = useMemo(() => {
    const d = buildDungeon(snap.seed, snap.depth);
    const s = d.marketStall;
    return { x: s.x, y: groundHeightAt(s.x, s.z, d), z: s.z };
  }, [snap.seed, snap.depth]);
  const crate = useGLTF(DUNGEON_ASSETS.crate);
  const chest = useGLTF(DUNGEON_ASSETS.chest_open);
  const group = useRef<Group>(null);

  const crateClone = useMemo(() => {
    const c = SkeletonUtils.clone(crate.scene) as Group;
    c.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return c;
  }, [crate.scene]);
  const chestClone = useMemo(() => {
    const c = SkeletonUtils.clone(chest.scene) as Group;
    c.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return c;
  }, [chest.scene]);

  const handleClick = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    const d = Math.hypot(localPlayerPos.x - stall.x, localPlayerPos.z - stall.z);
    if (d > OPEN_RANGE) {
      setClickDestination(stall.x, stall.z);
      return;
    }
    toggleMarket();
  };
  const handleOver = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    setGameCursor("trade");
  };
  const handleOut = () => {
    setGameCursor("default");
  };

  return (
    <group ref={group} position={[stall.x, stall.y, stall.z]}>
      {/* On the official map the weapon_market cabin IS the stall — hide the
          placeholder crate/chest and keep just the label + click hit-plane. */}
      {!USE_OFFICIAL_MAP && (
        <>
          <primitive object={crateClone} scale={5.5} />
          <primitive object={chestClone} position={[0.9, 0, 0.4]} rotation={[0, -0.6, 0]} scale={2.6} />
        </>
      )}
      <Billboard position={[0, 2.4, 0]}>
        <Text fontSize={0.42} color="#fbbf24" outlineWidth={0.02} outlineColor="#000000">
          Market
        </Text>
      </Billboard>
      <mesh position={[0, 0.9, 0]} onPointerDown={handleClick} onPointerOver={handleOver} onPointerOut={handleOut}>
        <capsuleGeometry args={[1.1, 1.0, 4, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
