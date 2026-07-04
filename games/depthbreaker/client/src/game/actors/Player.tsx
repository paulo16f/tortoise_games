import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import type { Group, MeshStandardMaterial } from "three";
import { MathUtils } from "three";
import { zoneStore } from "../../net/room";
import { combatBus } from "../../net/combatBus";
import { localPlayerPos } from "../entityRefs";
import { resolvePlayerModel } from "./useModel";
import { AnimatedCharacter } from "./AnimatedCharacter";
import { FLINCH_MS } from "../fx/fxConstants";

interface PlayerProps {
  id: string;
  isLocal: boolean;
}

const LOCAL_COLOR = "#3b82f6";
const OTHER_COLOR = "#22c55e";
const DEAD_COLOR = "#4b5563";

export function Player({ id, isLocal }: PlayerProps) {
  const group = useRef<Group>(null);
  const bodyMat = useRef<MeshStandardMaterial>(null);
  const modelMats = useRef<MeshStandardMaterial[]>([]);
  const skillFx = useRef<Group>(null);
  const flinchStart = useRef(Number.NEGATIVE_INFINITY);

  useEffect(
    () =>
      combatBus.subscribe((f) => {
        if (f.kind !== "hit" && f.kind !== "crit") return;
        if (f.targetId === id && !zoneStore.state?.players.get(f.sourceId)) {
          flinchStart.current = performance.now() + f.delayMs;
        }
      }),
    [id],
  );

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const p = zoneStore.state?.players.get(id);
    if (!p) return;

    const t = Math.min(1, 15 * delta);
    g.position.x = MathUtils.lerp(g.position.x, p.x, t);
    g.position.z = MathUtils.lerp(g.position.z, p.z, t);
    g.position.y = p.y;
    g.rotation.y = lerpAngle(g.rotation.y, p.yaw, t);
    g.visible = p.alive;

    if (skillFx.current) skillFx.current.rotation.y += delta * 2.2;
    if (isLocal) localPlayerPos.set(g.position.x, g.position.y, g.position.z);

    const flinchAge = performance.now() - flinchStart.current;
    const flinching = flinchAge >= 0 && flinchAge < FLINCH_MS;
    const emIntensity = flinching ? 0.85 * (1 - flinchAge / FLINCH_MS) : 0;

    for (const m of modelMats.current) {
      m.emissive.set(emIntensity > 0 ? "#ff3b3b" : "#000000");
      m.emissiveIntensity = emIntensity;
    }
    const mat = bodyMat.current;
    if (mat) {
      if (emIntensity > 0) {
        mat.emissive.set("#ff3b3b");
        mat.emissiveIntensity = emIntensity;
      } else {
        mat.emissive.set(isLocal ? LOCAL_COLOR : "#000000");
        mat.emissiveIntensity = isLocal ? 0.25 : 0;
      }
    }
  });

  const p = zoneStore.state?.players.get(id);
  const alive = p?.alive ?? true;
  const name = p?.name ?? "";
  const classId = p?.classId ?? "";
  const model = resolvePlayerModel(classId);
  const visualHeight = model?.visualHeight ?? 1.8;
  const radius = model?.radius ?? 0.45;
  const color = !alive ? DEAD_COLOR : isLocal ? LOCAL_COLOR : OTHER_COLOR;

  return (
    <group ref={group}>
      {model ? (
        <AnimatedCharacter
          entityId={id}
          kind="player"
          url={model.url}
          weaponUrl={model.weaponUrl}
          handBoneNames={model.handBoneNames}
          clips={model.clips}
          targetHeight={model.targetHeight}
          weaponTransform={model.weaponTransform}
          onMaterials={(mats) => {
            modelMats.current = mats;
          }}
        />
      ) : (
        <>
          <mesh castShadow position={[0, 0.9, 0]}>
            <capsuleGeometry args={[0.4, 1.0, 4, 12]} />
            <meshStandardMaterial ref={bodyMat} color={color} emissive={isLocal ? LOCAL_COLOR : "#000000"} emissiveIntensity={isLocal ? 0.25 : 0} />
          </mesh>
          <mesh position={[0, 0.9, 0.45]}>
            <boxGeometry args={[0.15, 0.15, 0.3]} />
            <meshStandardMaterial color="#e2e8f0" />
          </mesh>
        </>
      )}

      {alive && (p?.shieldSeconds ?? 0) > 0 && (
        <mesh position={[0, visualHeight * 0.48, 0]}>
          <sphereGeometry args={[radius * 1.85, 24, 16]} />
          <meshStandardMaterial color="#facc15" emissive="#f59e0b" emissiveIntensity={0.55} transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}

      {alive && (p?.frostSeconds ?? 0) > 0 && (
        <group ref={skillFx}>
          {[0, 1, 2, 3].map((i) => {
            const a = (i / 4) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * radius * 2.8, visualHeight * 0.52, Math.sin(a) * radius * 2.8]}>
                <sphereGeometry args={[radius * 0.28, 12, 12]} />
                <meshStandardMaterial color="#93c5fd" emissive="#38bdf8" emissiveIntensity={1.8} />
              </mesh>
            );
          })}
        </group>
      )}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[radius * 1.0, radius * 1.18, 24]} />
        <meshBasicMaterial color={isLocal ? LOCAL_COLOR : OTHER_COLOR} transparent opacity={0.7} />
      </mesh>
      <Billboard position={[0, visualHeight + 0.35, 0]}>
        <Text fontSize={0.35} color="#f8fafc" outlineWidth={0.02} outlineColor="#0b0d12">
          {name}
        </Text>
      </Billboard>
    </group>
  );
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
