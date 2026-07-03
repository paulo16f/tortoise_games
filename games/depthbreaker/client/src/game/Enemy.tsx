// A single enemy entity: a red cone/box that lerps toward its server position.
// Clicking it sets the local player's target. The current target is highlighted.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import type { Group, Mesh } from "three";
import { MathUtils } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { zoneStore } from "../net/room";
import { resolveEnemyModel } from "./useModel";

interface EnemyProps {
  id: string;
  isTarget: boolean;
}

const ALIVE_COLOR = "#ef4444";
const DEAD_COLOR = "#3f3f46";
const TARGET_EMISSIVE = "#fbbf24";

export function Enemy({ id, isTarget }: EnemyProps) {
  const group = useRef<Group>(null);
  const bodyRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const e = zoneStore.state?.enemies.get(id);
    if (!e) return;

    const t = Math.min(1, 15 * delta);
    g.position.x = MathUtils.lerp(g.position.x, e.x, t);
    g.position.z = MathUtils.lerp(g.position.z, e.z, t);
    g.position.y = e.y;
    g.rotation.y = e.yaw;
  });

  const e = zoneStore.state?.enemies.get(id);
  const alive = e?.alive ?? true;
  const hpFrac = e && e.maxHp > 0 ? Math.max(0, e.hp / e.maxHp) : 1;
  // resolveEnemyModel is empty today -> undefined -> primitive fallback.
  void resolveEnemyModel(e?.defId ?? "");

  const handleClick = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    if (!alive) return;
    zoneStore.sendTarget(id);
  };

  const color = alive ? ALIVE_COLOR : DEAD_COLOR;

  return (
    <group ref={group}>
      <mesh
        ref={bodyRef}
        position={[0, 0.7, 0]}
        onPointerDown={handleClick}
        castShadow
      >
        <coneGeometry args={[0.5, 1.4, 6]} />
        <meshStandardMaterial
          color={color}
          emissive={isTarget ? TARGET_EMISSIVE : "#000000"}
          emissiveIntensity={isTarget ? 0.6 : 0}
          transparent={!alive}
          opacity={alive ? 1 : 0.35}
        />
      </mesh>

      {/* Target ring on the ground. */}
      {isTarget && alive && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.7, 0.9, 24]} />
          <meshBasicMaterial color={TARGET_EMISSIVE} />
        </mesh>
      )}

      {/* Simple floating HP bar. */}
      {alive && (
        <Billboard position={[0, 1.8, 0]}>
          <mesh position={[0, 0, 0]}>
            <planeGeometry args={[1.0, 0.12]} />
            <meshBasicMaterial color="#1f2937" />
          </mesh>
          <mesh position={[-(1.0 * (1 - hpFrac)) / 2, 0, 0.001]}>
            <planeGeometry args={[1.0 * hpFrac, 0.1]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
        </Billboard>
      )}
    </group>
  );
}
