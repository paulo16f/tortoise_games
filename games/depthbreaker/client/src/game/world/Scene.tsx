// The 3D scene: lighting, dungeon, entities, FX, and camera.

import { useMemo } from "react";
import { Environment, Lightformer } from "@react-three/drei";
import { zoneStore } from "../../net/room";
import { useZoneState } from "../../net/useZone";
import { Player } from "../actors/Player";
import { Enemy } from "../actors/Enemy";
import { CameraRig } from "./CameraRig";
import { CombatFloaters } from "../fx/CombatFloaters";
import { Projectiles } from "../fx/Projectiles";
import { DungeonClickPlane } from "./DungeonClickPlane";
import { BossPortal } from "./BossPortal";
import { ResourceNode } from "./ResourceNode";
import { MarketStall } from "./MarketStall";
import { ClickMarker } from "./ClickMarker";
import { RuntimeDungeon } from "./RuntimeDungeon";
import { SunLight } from "./SunLight";
import { DungeonGround } from "./DungeonGround";
import { Effects } from "./Effects";

export function Scene() {
  const snap = useZoneState();

  const { playerIds, enemyIds, nodeIds } = useMemo(() => {
    const players: string[] = [];
    const enemies: string[] = [];
    const nodes: string[] = [];
    const st = zoneStore.state;
    st?.players.forEach((_v, k) => players.push(k));
    st?.enemies.forEach((_v, k) => enemies.push(k));
    st?.nodes.forEach((_v, k) => nodes.push(k));
    return { playerIds: players, enemyIds: enemies, nodeIds: nodes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.playerCount, snap.enemyCount, snap.nodeCount]);

  const selfId = zoneStore.selfId;
  const targetId = snap.self?.targetId ?? "";

  return (
    <>
      <color attach="background" args={["#08090c"]} />
      {/* Fog far sits just past the ~70u room-cull boundary (RuntimeDungeon):
          rooms are ~90% fogged before they toggle, so no visible pop-in, but
          the playfield around the camera stays clearly lit (62 was too tight —
          it blacked out the screen edges under the top-down camera). */}
      <fog attach="fog" args={["#08090c", 28, 80]} />

      {/* Soft cool-over-warm fill instead of flat ambient. */}
      <hemisphereLight args={["#4a5a6a", "#181410", 0.35]} />
      {/* Warm key light with a player-following bounded shadow camera. */}
      <SunLight />
      {/* Self-contained dark-cave IBL (no CDN/HDRI files) for PBR fill/reflections. */}
      <Environment frames={1} resolution={256} environmentIntensity={0.3}>
        <color attach="background" args={["#04050a"]} />
        <Lightformer intensity={0.6} color="#6b7c92" position={[0, 8, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[30, 30, 1]} />
        <Lightformer intensity={0.9} color="#ffcf9a" position={[10, 4, 6]} rotation={[0, -Math.PI / 3, 0]} scale={[8, 8, 1]} />
        <Lightformer intensity={0.35} color="#3a5f7a" position={[-12, 3, -8]} rotation={[0, Math.PI / 3, 0]} scale={[10, 10, 1]} />
      </Environment>

      <DungeonGround />
      <RuntimeDungeon />
      <DungeonClickPlane />

      {playerIds.map((id) => (
        <Player key={id} id={id} isLocal={id === selfId} />
      ))}

      {enemyIds.map((id) => (
        <Enemy key={id} id={id} isTarget={id === targetId} />
      ))}

      {nodeIds.map((id) => (
        <ResourceNode key={id} id={id} />
      ))}
      <MarketStall />
      <ClickMarker />

      <CombatFloaters />
      <Projectiles />
      <BossPortal />
      <CameraRig />
      <Effects />
    </>
  );
}
