import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import type { Group } from "three";
import { useZoneState } from "../../net/useZone";
import { groundY } from "./groundMap";

export function BossPortal() {
  const snap = useZoneState();
  const portal = snap.bossPortal;
  const group = useRef<Group>(null);

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.9;
  });

  if (!portal.active) return null;

  return (
    <group ref={group} position={[portal.x, groundY(portal.x, portal.z) + 0.08, portal.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.2, 1.8, 48]} />
        <meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={2.2} transparent opacity={0.82} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
        <ringGeometry args={[0.45, 0.7, 32]} />
        <meshStandardMaterial color="#f0abfc" emissive="#f0abfc" emissiveIntensity={1.8} transparent opacity={0.72} />
      </mesh>
      <pointLight color="#a855f7" intensity={2.4} distance={8} position={[0, 1.2, 0]} />
      <Billboard position={[0, 2.2, 0]}>
        <Text fontSize={0.55} color="#f5d0fe" outlineWidth={0.035} outlineColor="#0b0d12">
          Boss {Math.ceil(portal.countdown)}
        </Text>
      </Billboard>
    </group>
  );
}
