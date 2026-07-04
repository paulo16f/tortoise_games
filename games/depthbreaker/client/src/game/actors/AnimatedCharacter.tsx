import { useEffect, useMemo, useRef } from "react";
import { useFrame, createPortal } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import {
  AnimationMixer,
  AnimationClip,
  Box3,
  Vector3,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Group,
  type AnimationAction,
  type Material,
} from "three";
import { zoneStore } from "../../net/room";
import { combatBus } from "../../net/combatBus";

export interface ClipSet {
  idle: string;
  run: string;
  attack: string;
  hit: string;
  death: string;
}

export const MELEE_CLIPS: ClipSet = {
  idle: "Idle",
  run: "Running_A",
  attack: "1H_Melee_Attack_Slice_Diagonal",
  hit: "Hit_A",
  death: "Death_A",
};

export const CASTER_CLIPS: ClipSet = {
  idle: "Idle",
  run: "Running_A",
  attack: "Spellcast_Shoot",
  hit: "Hit_A",
  death: "Death_A",
};

interface AnimatedCharacterProps {
  entityId: string;
  kind: "player" | "enemy";
  url: string;
  weaponUrl?: string;
  handBoneNames?: string[];
  clips?: ClipSet;
  targetHeight?: number;
  facingOffset?: number;
  weaponTransform?: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: number;
  };
  onMaterials?: (materials: MeshStandardMaterial[]) => void;
}

const RUN_SPEED_THRESHOLD = 0.45;
const HIT_CLIP_MS = 350;
const FADE = 0.15;
const DEFAULT_HAND_BONE_NAMES = ["handslot.r", "hand_r"];

function HeldWeapon({
  bone,
  url,
  transform,
}: {
  bone: Object3D;
  url: string;
  transform?: AnimatedCharacterProps["weaponTransform"];
}) {
  const { scene } = useGLTF(url);
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  return createPortal(
    <group position={transform?.position ?? [0, 0, 0]} rotation={transform?.rotation ?? [0, 0, 0]} scale={transform?.scale ?? 1}>
      <primitive object={clone} />
    </group>,
    bone,
  );
}

export function AnimatedCharacter({
  entityId,
  kind,
  url,
  weaponUrl,
  handBoneNames = DEFAULT_HAND_BONE_NAMES,
  clips = MELEE_CLIPS,
  targetHeight = 1.8,
  facingOffset = 0,
  weaponTransform,
  onMaterials,
}: AnimatedCharacterProps) {
  const { scene, animations } = useGLTF(url);

  const { root, mixer, actions, handBone, offsetY, clipDurations } = useMemo(() => {
    const root = SkeletonUtils.clone(scene) as Group;
    const materials: MeshStandardMaterial[] = [];
    let handBone: Object3D | null = null;
    root.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        const mesh = obj as Mesh;
        mesh.castShadow = true;
        mesh.raycast = () => null;
        const cloneMat = (m: Material) => {
          const c = m.clone();
          if (c instanceof MeshStandardMaterial) materials.push(c);
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneMat) : cloneMat(mesh.material);
      }
      if (!handBone && handBoneNames.includes(obj.name)) handBone = obj;
    });
    onMaterials?.(materials);

    const box = new Box3().setFromObject(root);
    const size = new Vector3();
    box.getSize(size);
    const scale = size.y > 1e-3 ? targetHeight / size.y : 1;
    root.scale.setScalar(scale);
    const offsetY = -box.min.y * scale;

    const mixer = new AnimationMixer(root);
    const actions: Record<string, AnimationAction> = {};
    const clipDurations: Record<string, number> = {};
    for (const clip of animations) {
      const sanitized = new AnimationClip(
        clip.name,
        clip.duration,
        clip.tracks.filter((track) => !track.name.endsWith(".position")),
      );
      clipDurations[clip.name] = sanitized.duration;
      actions[sanitized.name] = mixer.clipAction(sanitized, root);
    }
    return { root, mixer, actions, handBone, offsetY, clipDurations };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, animations, handBoneNames]);

  const current = useRef<string>("");
  const attackUntil = useRef(0);
  const hitUntil = useRef(0);
  const prevPos = useRef<{ x: number; z: number } | null>(null);
  const smoothedSpeed = useRef(0);
  const wasDead = useRef(false);

  const play = (name: string, once: boolean) => {
    const next = actions[name];
    if (!next || current.current === name) return;
    const prev = current.current ? actions[current.current] : undefined;
    next.reset();
    next.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.fadeIn(FADE).play();
    if (prev && prev !== next) prev.fadeOut(FADE);
    current.current = name;
  };

  useEffect(() => {
    return combatBus.subscribe((f) => {
      const damaging = f.kind === "hit" || f.kind === "crit" || (f.kind === "skill" && f.amount > 0);
      if (!damaging) return;
      if (f.sourceId === entityId) {
        attackUntil.current = performance.now() + f.delayMs + ((clipDurations[clips.attack] ?? 0.5) * 1000);
      }
      if (f.targetId === entityId) hitUntil.current = performance.now() + f.delayMs + HIT_CLIP_MS;
    });
  }, [entityId, clipDurations, clips.attack]);

  useFrame((_, delta) => {
    const st = zoneStore.state;
    const e = kind === "player" ? st?.players.get(entityId) : st?.enemies.get(entityId);
    if (!e) return;

    let speed = 0;
    if (prevPos.current) {
      const dx = e.x - prevPos.current.x;
      const dz = e.z - prevPos.current.z;
      speed = Math.hypot(dx, dz) / Math.max(delta, 1e-3);
    }
    prevPos.current = { x: e.x, z: e.z };
    smoothedSpeed.current += (speed - smoothedSpeed.current) * Math.min(1, delta * 10);
    speed = smoothedSpeed.current;

    const now = performance.now();
    if (!e.alive) {
      play(clips.death, true);
      wasDead.current = true;
    } else {
      if (wasDead.current) {
        current.current = "";
        wasDead.current = false;
      }
      if (now < attackUntil.current) play(clips.attack, true);
      else if (now < hitUntil.current) play(clips.hit, true);
      else if (speed > RUN_SPEED_THRESHOLD) play(clips.run, false);
      else play(clips.idle, false);
    }

    mixer.update(delta);
  });

  useEffect(
    () => () => {
      mixer.stopAllAction();
    },
    [mixer],
  );

  return (
    <group position={[0, offsetY, 0]} rotation={[0, facingOffset, 0]}>
      <primitive object={root} />
      {weaponUrl && handBone && <HeldWeapon bone={handBone} url={weaponUrl} transform={weaponTransform} />}
    </group>
  );
}
