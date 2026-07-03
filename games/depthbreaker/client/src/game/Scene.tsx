// The 3D scene: lighting, ground + grid, and all player/enemy entities. Entity
// ID lists come from throttled state (useZoneState); per-frame positions are
// read imperatively inside each Player/Enemy via useFrame.

import { useMemo } from "react";
import { Grid } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { zoneStore } from "../net/room";
import { useZoneState } from "../net/useZone";
import { Player } from "./Player";
import { Enemy } from "./Enemy";
import { CameraRig } from "./CameraRig";

export function Scene() {
  const snap = useZoneState();

  // Collect current entity ids from live state (snap is the change trigger).
  const { playerIds, enemyIds } = useMemo(() => {
    const players: string[] = [];
    const enemies: string[] = [];
    const st = zoneStore.state;
    st?.players.forEach((_v, k) => players.push(k));
    st?.enemies.forEach((_v, k) => enemies.push(k));
    return { playerIds: players, enemyIds: enemies };
    // Recompute whenever counts change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.playerCount, snap.enemyCount]);

  const selfId = zoneStore.selfId;
  const targetId = snap.self?.targetId ?? "";

  // Clicking empty ground clears the target.
  const handleGroundClick = (ev: ThreeEvent<PointerEvent>) => {
    // Only clear if nothing stopped propagation (i.e. not an enemy click).
    ev.stopPropagation();
    if (targetId) zoneStore.sendTarget("");
  };

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[20, 30, 10]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <fog attach="fog" args={["#0b0d12", 40, 90]} />

      {/* Ground plane (click to clear target). */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
        onPointerDown={handleGroundClick}
      >
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#12151c" />
      </mesh>

      <Grid
        args={[100, 100]}
        position={[0, 0.01, 0]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#1f2937"
        sectionSize={10}
        sectionThickness={1.1}
        sectionColor="#334155"
        fadeDistance={80}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {playerIds.map((id) => (
        <Player key={id} id={id} isLocal={id === selfId} />
      ))}

      {enemyIds.map((id) => (
        <Enemy key={id} id={id} isTarget={id === targetId} />
      ))}

      <CameraRig />
    </>
  );
}
