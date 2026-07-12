// Town fountain at the player spawn: a safe heal pad. The server regenerates HP
// for anyone standing within FOUNTAIN_RADIUS (ZoneRoom.updateFountain); this is
// purely the visual — a stone basin, a glowing water disc, a soft up-light, and
// a slow breathing ring so players read the footprint as "safe here".

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import type { Mesh } from "three";
import { buildDungeon, FOUNTAIN_RADIUS } from "@depthbreaker/protocol";
import { useZoneState } from "../../net/useZone";

export function Fountain() {
  const snap = useZoneState();
  const pad = useMemo(() => buildDungeon(snap.seed, snap.depth).playerSpawn, [snap.seed, snap.depth]);
  const ring = useRef<Mesh>(null);
  const water = useRef<Mesh>(null);

  // Slow "breathing" pulse on the aura ring + a gentle water shimmer.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ring.current) {
      const s = 1 + Math.sin(t * 1.4) * 0.05;
      ring.current.scale.set(s, s, s);
      const mat = ring.current.material as { opacity: number };
      mat.opacity = 0.22 + (Math.sin(t * 1.4) + 1) * 0.09;
    }
    if (water.current) {
      water.current.position.y = 0.62 + Math.sin(t * 2) * 0.015;
    }
  });

  return (
    <group position={[pad.x, 0, pad.z]}>
      {/* Safe-zone aura ring on the ground, sized to the heal radius. */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[FOUNTAIN_RADIUS - 0.35, FOUNTAIN_RADIUS, 48]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.28} depthWrite={false} />
      </mesh>

      {/* Stone basin: a low outer ring wall + a solid pedestal. */}
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.5, 1.65, 0.56, 24]} />
        <meshStandardMaterial color="#6b7280" roughness={0.9} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[1.28, 1.28, 0.5, 24]} />
        <meshStandardMaterial color="#0f2b3a" roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Glowing water disc (emissive so it reads as the heal source). */}
      <mesh ref={water} position={[0, 0.62, 0]}>
        <cylinderGeometry args={[1.2, 1.2, 0.06, 24]} />
        <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.9} roughness={0.2} transparent opacity={0.92} />
      </mesh>

      {/* Central spout column + basin up-light. */}
      <mesh position={[0, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.22, 0.8, 12]} />
        <meshStandardMaterial color="#9ca3af" roughness={0.8} />
      </mesh>
      <pointLight position={[0, 1.4, 0]} color="#5eead4" intensity={6} distance={9} decay={2} />

      <Billboard position={[0, 2.5, 0]}>
        <Text fontSize={0.36} color="#5eead4" outlineWidth={0.02} outlineColor="#000000">
          Fountain — rest to heal
        </Text>
      </Billboard>
    </group>
  );
}
