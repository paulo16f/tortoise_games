// The 3D scene: lighting, dungeon, entities, FX, and camera.

import { useMemo } from "react";
import { zoneStore } from "../../net/room";
import { useZoneState } from "../../net/useZone";
import { Player } from "../actors/Player";
import { Enemy } from "../actors/Enemy";
import { CameraRig } from "./CameraRig";
import { CombatFloaters } from "../fx/CombatFloaters";
import { Projectiles } from "../fx/Projectiles";
import { Dungeon } from "./Dungeon";
import { BossPortal } from "./BossPortal";

export function Scene() {
  const snap = useZoneState();

  const { playerIds, enemyIds } = useMemo(() => {
    const players: string[] = [];
    const enemies: string[] = [];
    const st = zoneStore.state;
    st?.players.forEach((_v, k) => players.push(k));
    st?.enemies.forEach((_v, k) => enemies.push(k));
    return { playerIds: players, enemyIds: enemies };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.playerCount, snap.enemyCount]);

  const selfId = zoneStore.selfId;
  const targetId = snap.self?.targetId ?? "";

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight
        position={[20, 30, 10]}
        intensity={1.35}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <fog attach="fog" args={["#0b0d12", 40, 90]} />

      <Dungeon />

      {playerIds.map((id) => (
        <Player key={id} id={id} isLocal={id === selfId} />
      ))}

      {enemyIds.map((id) => (
        <Enemy key={id} id={id} isTarget={id === targetId} />
      ))}

      <CombatFloaters />
      <Projectiles />
      <BossPortal />
      <CameraRig />
    </>
  );
}
