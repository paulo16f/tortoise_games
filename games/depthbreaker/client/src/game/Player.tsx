// A single player entity. Lerps its mesh toward the server-authoritative
// (x, z, yaw) each frame instead of snapping. The local player is colored
// distinctly and reports its position to the CameraRig via localPlayerPos.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import type { Group } from "three";
import { MathUtils } from "three";
import { zoneStore } from "../net/room";
import { localPlayerPos } from "./entityRefs";
import { resolvePlayerModel } from "./useModel";

interface PlayerProps {
  id: string;
  isLocal: boolean;
}

const LOCAL_COLOR = "#3b82f6";
const OTHER_COLOR = "#22c55e";
const DEAD_COLOR = "#4b5563";

export function Player({ id, isLocal }: PlayerProps) {
  const group = useRef<Group>(null);
  const nameRef = useRef<string>("");

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const st = zoneStore.state;
    const p = st?.players.get(id);
    if (!p) return;
    nameRef.current = p.name;

    const t = Math.min(1, 15 * delta);
    g.position.x = MathUtils.lerp(g.position.x, p.x, t);
    g.position.z = MathUtils.lerp(g.position.z, p.z, t);
    g.position.y = p.y; // vertical is server-driven, no need to smooth
    g.rotation.y = lerpAngle(g.rotation.y, p.yaw, t);
    g.visible = p.alive;

    if (isLocal) {
      localPlayerPos.set(g.position.x, g.position.y, g.position.z);
    }
  });

  const st = zoneStore.state;
  const p = st?.players.get(id);
  const alive = p?.alive ?? true;
  const name = p?.name ?? "";
  const classId = p?.classId ?? "";
  // resolvePlayerModel is empty today -> always undefined -> primitive fallback.
  void resolvePlayerModel(classId);

  const color = !alive ? DEAD_COLOR : isLocal ? LOCAL_COLOR : OTHER_COLOR;

  return (
    <group ref={group}>
      {/* Primitive fallback body. Swap for a GLB via useModel once art exists. */}
      <mesh castShadow position={[0, 0.9, 0]}>
        <capsuleGeometry args={[0.4, 1.0, 4, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={isLocal ? LOCAL_COLOR : "#000000"}
          emissiveIntensity={isLocal ? 0.25 : 0}
        />
      </mesh>
      {/* Facing indicator. */}
      <mesh position={[0, 0.9, 0.45]}>
        <boxGeometry args={[0.15, 0.15, 0.3]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      <Billboard position={[0, 2.2, 0]}>
        <Text fontSize={0.35} color="#f8fafc" outlineWidth={0.02} outlineColor="#0b0d12">
          {name}
        </Text>
      </Billboard>
    </group>
  );
}

/** Shortest-path angular lerp (radians). */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
