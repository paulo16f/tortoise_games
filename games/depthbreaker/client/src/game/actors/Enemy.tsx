import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import type { Group, MeshStandardMaterial } from "three";
import { MathUtils } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { zoneStore } from "../../net/room";
import { combatBus } from "../../net/combatBus";
import { localPlayerPos } from "../entityRefs";
import { resolveEnemyModel } from "./useModel";
import { AnimatedCharacter } from "./AnimatedCharacter";
import { HIT_FLASH_MS } from "../fx/fxConstants";

interface EnemyProps {
  id: string;
  isTarget: boolean;
}

const ALIVE_COLOR = "#ef4444";
const DEAD_COLOR = "#3f3f46";
const TARGET_EMISSIVE = "#ef4444";
const HOVER_EMISSIVE = "#fca5a5";

function blocksCameraRay(x: number, z: number, cameraX: number, cameraZ: number): boolean {
  const p = localPlayerPos;
  const abx = p.x - cameraX;
  const abz = p.z - cameraZ;
  const apx = x - cameraX;
  const apz = z - cameraZ;
  const abLenSq = abx * abx + abz * abz;
  if (abLenSq < 0.0001) return false;
  const t = (apx * abx + apz * abz) / abLenSq;
  if (t <= 0.08 || t >= 0.9) return false;
  const cx = cameraX + abx * t;
  const cz = cameraZ + abz * t;
  return Math.hypot(x - cx, z - cz) < 1.25;
}

export function Enemy({ id, isTarget }: EnemyProps) {
  const camera = useThree((s) => s.camera);
  const group = useRef<Group>(null);
  const bodyMat = useRef<MeshStandardMaterial>(null);
  const modelMats = useRef<MeshStandardMaterial[]>([]);
  const reticle = useRef<Group>(null);
  const flashAt = useRef(Number.NEGATIVE_INFINITY);
  const hovered = useRef(false);

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
    if (!e) return;

    const t = Math.min(1, 15 * delta);
    g.position.x = MathUtils.lerp(g.position.x, e.x, t);
    g.position.z = MathUtils.lerp(g.position.z, e.z, t);
    g.position.y = e.y;
    g.rotation.y = lerpAngle(g.rotation.y, e.yaw, t);
    g.visible = e.alive && !blocksCameraRay(g.position.x, g.position.z, camera.position.x, camera.position.z);
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
    if (alive) zoneStore.sendTarget(id);
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
          <AnimatedCharacter entityId={id} kind="enemy" url={model.url} weaponUrl={model.weaponUrl} handBoneNames={model.handBoneNames} clips={model.clips} targetHeight={model.targetHeight} weaponTransform={model.weaponTransform} onMaterials={(mats) => { modelMats.current = mats; }} />
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
