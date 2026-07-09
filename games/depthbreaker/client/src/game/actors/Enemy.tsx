import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import type { Group, MeshStandardMaterial } from "three";
import { MathUtils } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { zoneStore } from "../../net/room";
import { combatBus } from "../../net/combatBus";
import { clearClickDestination } from "../input/controls";
import { resolveEnemyModel } from "./useModel";
import { AnimatedCharacter } from "./AnimatedCharacter";
import { DEFAULT_MOTION_PROFILE } from "./motionProfiles";
import { HIT_FLASH_MS } from "../fx/fxConstants";

interface EnemyProps {
  id: string;
  isTarget: boolean;
}

const ALIVE_COLOR = "#ef4444";
const DEAD_COLOR = "#3f3f46";
const TARGET_EMISSIVE = "#ef4444";
const HOVER_EMISSIVE = "#fca5a5";

export function Enemy({ id, isTarget }: EnemyProps) {
  const group = useRef<Group>(null);
  const bodyMat = useRef<MeshStandardMaterial>(null);
  const modelMats = useRef<MeshStandardMaterial[]>([]);
  const reticle = useRef<Group>(null);
  const flashAt = useRef(Number.NEGATIVE_INFINITY);
  const hovered = useRef(false);
  const initialized = useRef(false);

  useEffect(
    () =>
      combatBus.subscribe((f) => {
        if (f.kind !== "hit" && f.kind !== "crit" && f.kind !== "skill") return;
        if (f.targetId === id) flashAt.current = performance.now() + f.delayMs;
      }),
    [id],
  );

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const e = zoneStore.state?.enemies.get(id);
    if (!e) {
      g.visible = false;
      return;
    }

    const profile = resolveEnemyModel(e.defId)?.motionProfile ?? DEFAULT_MOTION_PROFILE;
    const positionT = Math.min(1, profile.positionLerp * delta);
    const turnT = Math.min(1, profile.turnLerp * delta);
    const dx = e.x - g.position.x;
    const dz = e.z - g.position.z;
    if (!initialized.current || Math.hypot(dx, dz) > profile.positionSnapDistance) {
      g.position.x = e.x;
      g.position.z = e.z;
      initialized.current = true;
    } else {
      g.position.x = MathUtils.lerp(g.position.x, e.x, positionT);
      g.position.z = MathUtils.lerp(g.position.z, e.z, positionT);
    }
    g.position.y = e.y;
    g.rotation.y = lerpAngle(g.rotation.y, e.yaw, turnT);
    g.visible = true;
    if (reticle.current) reticle.current.rotation.z -= delta * 1.5;

    const sinceFlash = performance.now() - flashAt.current;
    const flashing = sinceFlash >= 0 && sinceFlash < HIT_FLASH_MS;
    const applyEmissive = (m: MeshStandardMaterial) => {
      if (flashing) {
        m.emissive.set("#ffffff");
        m.emissiveIntensity = 0.9;
      } else if (isTarget) {
        m.emissive.set(TARGET_EMISSIVE);
        m.emissiveIntensity = 0.5;
      } else if (hovered.current) {
        m.emissive.set(HOVER_EMISSIVE);
        m.emissiveIntensity = 0.3;
      } else {
        m.emissive.set("#000000");
        m.emissiveIntensity = 0;
      }
    };
    if (bodyMat.current) applyEmissive(bodyMat.current);
    for (const m of modelMats.current) applyEmissive(m);
  });

  const e = zoneStore.state?.enemies.get(id);
  const alive = e?.alive ?? true;
  const hpFrac = e && e.maxHp > 0 ? Math.max(0, e.hp / e.maxHp) : 1;
  const model = resolveEnemyModel(e?.defId ?? "");
  const visualHeight = model?.visualHeight ?? 1.4;
  const radius = model?.radius ?? 0.5;

  const handleClick = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    if (alive) {
      clearClickDestination();
      zoneStore.sendTarget(id, true);
    }
  };
  const handleOver = (ev: ThreeEvent<PointerEvent>) => {
    ev.stopPropagation();
    if (!alive) return;
    hovered.current = true;
    document.body.style.cursor = "pointer";
  };
  const handleOut = () => {
    hovered.current = false;
    document.body.style.cursor = "auto";
  };

  const color = alive ? ALIVE_COLOR : DEAD_COLOR;

  return (
    <group ref={group}>
      {model ? (
        <>
          <AnimatedCharacter entityId={id} kind="enemy" url={model.url} weaponUrl={model.weaponUrl} handBoneNames={model.handBoneNames} clips={model.clips} targetHeight={model.targetHeight} weaponTransform={model.weaponTransform} naturalHeight={model.naturalHeight} restMinY={model.restMinY} motionProfile={model.motionProfile} strideNorm={model.strideNorm} onMaterials={(mats) => { modelMats.current = mats; }} />
          {alive && (
            <mesh position={[0, visualHeight * 0.5, 0]} onPointerDown={handleClick} onPointerOver={handleOver} onPointerOut={handleOut}>
              <capsuleGeometry args={[radius, Math.max(0.1, visualHeight - radius * 2), 4, 8]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          )}
        </>
      ) : (
        <mesh position={[0, 0.7, 0]} onPointerDown={handleClick} onPointerOver={handleOver} onPointerOut={handleOut} castShadow>
          <coneGeometry args={[0.5, 1.4, 6]} />
          <meshStandardMaterial ref={bodyMat} color={color} emissive={isTarget ? TARGET_EMISSIVE : "#000000"} emissiveIntensity={isTarget ? 0.6 : 0} transparent={!alive} opacity={alive ? 1 : 0.35} />
        </mesh>
      )}

      {isTarget && alive && (
        <group ref={reticle} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <mesh>
            <ringGeometry args={[radius * 1.4, radius * 1.62, 4, 1]} />
            <meshBasicMaterial color={TARGET_EMISSIVE} transparent opacity={0.9} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <ringGeometry args={[radius * 1.8, radius * 1.95, 4, 1]} />
            <meshBasicMaterial color={TARGET_EMISSIVE} transparent opacity={0.5} />
          </mesh>
        </group>
      )}

      {alive && (
        <Billboard position={[0, visualHeight + 0.28, 0]}>
          <mesh>
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

function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
