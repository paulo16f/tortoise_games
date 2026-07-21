import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import type { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { MathUtils } from "three";
import { zoneStore } from "../../net/room";
import { combatBus } from "../../net/combatBus";
import { localPlayerPos } from "../entityRefs";
import { resolvePlayerModel, resolveWeaponModel } from "./useModel";
import { AnimatedCharacter } from "./AnimatedCharacter";
import { DEFAULT_MOTION_PROFILE } from "./motionProfiles";
import { FLINCH_MS } from "../fx/fxConstants";
import { predictLocalMovement } from "./prediction";

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
  const shieldMesh = useRef<Mesh>(null);
  const ampRing = useRef<Mesh>(null);
  const flinchStart = useRef(Number.NEGATIVE_INFINITY);
  const initialized = useRef(false);

  useEffect(
    () =>
      combatBus.subscribe((f) => {
        // Any incoming hit/crit flinches the victim — PvE and PvP alike (the old
        // gate skipped player-sourced damage, muting PvP).
        if (f.kind !== "hit" && f.kind !== "crit") return;
        if (f.targetId === id) flinchStart.current = performance.now() + f.delayMs;
      }),
    [id],
  );

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const p = zoneStore.state?.players.get(id);
    if (!p) return;

    const profile = resolvePlayerModel(p.classId)?.motionProfile ?? DEFAULT_MOTION_PROFILE;
    // Frame-rate-independent smoothing (1 - e^-rate·dt) so feel is identical at
    // any FPS. Snap on a big gap (dash/respawn teleport) instead of sliding.
    const posT = 1 - Math.exp(-profile.positionLerp * delta);
    const turnT = 1 - Math.exp(-profile.turnLerp * delta);

    // Local player with move intent → client-side prediction (instant response;
    // server-reconciled inside predictLocalMovement). Everything else — remote
    // players and all server-driven movement — uses the plain server lerp.
    const snap = zoneStore.getSnapshot();
    const predicted = isLocal && initialized.current
      ? predictLocalMovement(p.x, p.z, g.position.x, g.position.z, snap.seed, snap.depth, p.alive, delta)
      : null;
    if (predicted) {
      g.position.x = predicted.x;
      g.position.z = predicted.z;
      // Face the move direction immediately (the server's yaw arrives late).
      g.rotation.y = lerpAngle(g.rotation.y, predicted.yaw, 1 - Math.exp(-14 * delta));
    } else {
      const gap = Math.hypot(p.x - g.position.x, p.z - g.position.z);
      if (!initialized.current || gap > profile.positionSnapDistance) {
        g.position.x = p.x;
        g.position.z = p.z;
        initialized.current = true;
      } else {
        g.position.x = MathUtils.lerp(g.position.x, p.x, posT);
        g.position.z = MathUtils.lerp(g.position.z, p.z, posT);
      }
      g.rotation.y = lerpAngle(g.rotation.y, p.yaw, turnT);
    }
    g.position.y = p.y;
    g.visible = p.alive;

    if (skillFx.current) skillFx.current.rotation.y += delta * 2.2;
    // Living buff visuals: the shield bubble breathes (urgent flicker in its
    // last second), the amp aura slowly spins + pulses.
    const now = performance.now();
    if (shieldMesh.current) {
      const shieldLeft = p.shieldSeconds ?? 0;
      const breathe = 1 + 0.05 * Math.sin(now / 190);
      shieldMesh.current.scale.setScalar(breathe);
      const m = shieldMesh.current.material as MeshStandardMaterial;
      m.opacity = shieldLeft < 1 ? 0.1 + 0.16 * Math.abs(Math.sin(now / 90)) : 0.18 + 0.07 * Math.sin(now / 300);
    }
    if (ampRing.current) {
      ampRing.current.rotation.z += delta * 1.6;
      (ampRing.current.material as MeshBasicMaterial).opacity = 0.45 + 0.2 * Math.sin(now / 250);
    }
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
  const model = resolvePlayerModel(classId, p?.skinId);
  // Render the equipped weapon's own model (axe looks like an axe), falling back
  // to the class default if the weapon has no mapped model.
  const weaponUrl = p?.weaponId ? resolveWeaponModel(p.weaponId) ?? model?.weaponUrl : undefined;
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
          weaponUrl={weaponUrl}
          handBoneNames={model.handBoneNames}
          clips={model.clips}
          targetHeight={model.targetHeight}
          weaponTransform={model.weaponTransform}
          naturalHeight={model.naturalHeight}
          restMinY={model.restMinY}
          motionProfile={model.motionProfile}
          strideNorm={model.strideNorm}
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
        <mesh ref={shieldMesh} position={[0, visualHeight * 0.48, 0]}>
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

      {alive && (p?.ampSeconds ?? 0) > 0 && (
        <mesh ref={ampRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[radius * 1.5, radius * 1.9, 32]} />
          <meshBasicMaterial color="#fde68a" transparent opacity={0.6} depthWrite={false} />
        </mesh>
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
