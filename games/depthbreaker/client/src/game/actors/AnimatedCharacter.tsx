import { useEffect, useMemo, useRef } from "react";
import { useFrame, createPortal } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import {
  AnimationMixer,
  AnimationClip,
  Box3,
  Vector3,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Group,
  type AnimationAction,
  type KeyframeTrack,
  type Material,
} from "three";
import { useCombatAnimState } from "./useCombatAnimState";
import { useLocomotion } from "./useLocomotion";
import { DEFAULT_MOTION_PROFILE, type MotionProfile } from "./motionProfiles";
import { LocomotionController, type ClipSet, type LocoInputs, type StrideNorm } from "./locomotionController";

export type { ClipSet, StrideNorm } from "./locomotionController";

/** Preview states for the ?debugAnim harness. */
export type PreviewState = "idle" | "walk" | "run" | "sprint" | "turn" | "attack" | "hit" | "death";

const DEFAULT_CLIPS: ClipSet = {
  idle: "idle",
  walk: "walk",
  run: "run",
  sprint: "sprint",
  walkStart: "walk_start",
  runStart: "run_start",
  walkStop: "walk_stop",
  runStop: "run_stop",
  turnLeft: "turn_l",
  turnRight: "turn_r",
  attack: "attack",
  hit: "hit",
  death: "death",
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
  // Bind-pose height/foot-offset recorded offline (see useModel.ts /
  // runtime/manifest.json). When both are provided, scale/offset are
  // computed directly from them instead of measuring a freshly-cloned
  // SkinnedMesh's bounding box at runtime.
  naturalHeight?: number;
  restMinY?: number;
  motionProfile?: MotionProfile;
  /** Per-clip normalized forward travel for foot-locking (runtime manifest). */
  strideNorm?: StrideNorm;
  previewState?: PreviewState;
  previewSpeed?: number;
  onMaterials?: (materials: MeshStandardMaterial[]) => void;
}

const DEFAULT_HAND_BONE_NAMES = ["Hand_R", "hand_r", "handslot.r"];
const MIN_SANE_SCALE = 0.05;
const MAX_SANE_SCALE = 3;
const PREVIEW_TURN_RATE = 3;

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

  // A weapon parented via createPortal inherits the hand bone's full
  // accumulated world scale. The character's own skinned mesh isn't affected
  // by whatever internal scale convention a rig uses (skinning compensates
  // for it via inverse bind matrices), but this plain, non-skinned mesh has
  // no such compensation - so counter-scale by the bone's real world scale
  // first, then apply the authored transform on top of that. This keeps
  // `weaponTransform.scale`/`position` meaning "relative to the character's
  // own visible size" regardless of the source rig's internal scale quirks.
  // Position needs the exact same treatment as scale: it's specified in the
  // bone's local space, so on a rig whose bones carry a tiny internal scale
  // (this one measures ~0.006), an authored offset like [0.02, 0, 0.02]
  // collapses to a fraction of a millimeter in world space unless divided
  // back out here too.
  const { scale, position } = useMemo(() => {
    bone.updateWorldMatrix(true, false);
    const worldScale = new Vector3();
    bone.getWorldScale(worldScale);
    const authoredScale = transform?.scale ?? 1;
    const authoredPosition = transform?.position ?? [0, 0, 0];
    const compensated = worldScale.x > 1e-6 ? 1 / worldScale.x : 1;
    return {
      scale: authoredScale * compensated,
      position: authoredPosition.map((v) => v * compensated) as [number, number, number],
    };
  }, [bone, transform?.scale, transform?.position]);

  return createPortal(
    <group position={position} rotation={transform?.rotation ?? [0, 0, 0]} scale={scale}>
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
  clips = DEFAULT_CLIPS,
  targetHeight = 1.8,
  facingOffset = 0,
  weaponTransform,
  naturalHeight,
  restMinY,
  motionProfile = DEFAULT_MOTION_PROFILE,
  strideNorm,
  previewState,
  previewSpeed = 0,
  onMaterials,
}: AnimatedCharacterProps) {
  const { scene, animations } = useGLTF(url);

  const { root, mixer, controller, handBone, offsetY } = useMemo(() => {
    const root = SkeletonUtils.clone(scene) as Group;
    // A freshly-cloned object's matrixWorld starts stale (identity) until an
    // update cycle runs - Box3.setFromObject was proven earlier this session
    // to silently use that stale state instead of forcing a fresh update, so
    // force it explicitly before anything below relies on world transforms.
    root.updateMatrixWorld(true);
    const materials: MeshStandardMaterial[] = [];
    let handBone: Object3D | null = null;
    root.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        const mesh = obj as Mesh;
        mesh.castShadow = true;
        mesh.raycast = () => null;
        const cloneMat = (m: Material) => {
          const c = m.clone();
          if (c instanceof MeshStandardMaterial) {
            applyRimGlow(c);
            materials.push(c);
          }
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cloneMat) : cloneMat(mesh.material);
      }
      if (!handBone && handBoneNames.includes(obj.name)) handBone = obj;
    });
    onMaterials?.(materials);

    let height: number;
    let minY: number;
    if (naturalHeight !== undefined && restMinY !== undefined) {
      height = naturalHeight;
      minY = restMinY;
    } else {
      const box = new Box3().setFromObject(root);
      const size = new Vector3();
      box.getSize(size);
      height = size.y;
      minY = box.min.y;
    }

    let scale = height > 1e-3 ? targetHeight / height : 1;
    if (!Number.isFinite(scale) || scale < MIN_SANE_SCALE || scale > MAX_SANE_SCALE) {
      console.warn(`AnimatedCharacter: rejecting unsafe scale ${scale} for ${url} (height=${height}, targetHeight=${targetHeight}); using scale 1`);
      scale = 1;
    }
    root.scale.setScalar(scale);
    const offsetY = -minY * scale;

    const mixer = new AnimationMixer(root);
    const actions: Record<string, AnimationAction> = {};
    for (const clip of animations) {
      const sanitized = new AnimationClip(clip.name, clip.duration, clip.tracks.filter((track) => keepRuntimeTrack(track, clip.name)));
      actions[sanitized.name] = mixer.clipAction(sanitized, root);
    }

    const controller = new LocomotionController({
      actions,
      clips,
      visualHeight: targetHeight,
      strideNorm,
      profile: motionProfile,
    });

    return { root, mixer, controller, handBone, offsetY };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, animations, handBoneNames]);

  const groupRef = useRef<Group>(null);
  const worldPos = useRef(new Vector3());
  const anim = useCombatAnimState(entityId, kind, Math.max(motionProfile.attackLockMs, 380), motionProfile);
  const locomotion = useLocomotion();

  useFrame((_, delta) => {
    let inputs: LocoInputs | null;
    if (previewState) {
      inputs = previewInputs(previewState, previewSpeed);
    } else {
      // Derive locomotion speed from this character's own rendered world position
      // (already interpolated toward the server position by Player/Enemy), not
      // from raw network snapshots - see useLocomotion for why.
      const g = groupRef.current;
      let loco = { speed: 0, moving: false };
      if (g) {
        g.getWorldPosition(worldPos.current);
        loco = locomotion.update(worldPos.current.x, worldPos.current.z, delta);
      }
      inputs = anim.update(delta, loco);
    }

    if (inputs) controller.update(inputs, delta);
    mixer.update(delta);
  });

  useEffect(
    () => () => {
      mixer.stopAllAction();
    },
    [mixer],
  );

  return (
    <group ref={groupRef} position={[0, offsetY, 0]} rotation={[0, facingOffset, 0]}>
      <primitive object={root} />
      {weaponUrl && handBone && <HeldWeapon bone={handBone} url={weaponUrl} transform={weaponTransform} />}
    </group>
  );
}

function previewInputs(state: PreviewState, speed: number): LocoInputs {
  if (state === "attack" || state === "hit" || state === "death") {
    return { speed: 0, moving: false, yawRate: 0, combat: { kind: state, actionId: "preview" }, alive: state !== "death" };
  }
  if (state === "turn") {
    return { speed: 0, moving: false, yawRate: PREVIEW_TURN_RATE, combat: null, alive: true };
  }
  const moving = speed > 0.15 && state !== "idle";
  return { speed: state === "idle" ? 0 : speed, moving, yawRate: 0, combat: null, alive: true };
}

// Cool fresnel rim light baked into each character material, ported from
// world-of-claudecraft's addRimGlow - it makes the chibi silhouettes read
// against the dark dungeon ground/fog. Added to totalEmissiveRadiance (not the
// material.emissive uniform), so it composes with the per-frame hit-flash /
// target-highlight emissive the actors already drive.
function applyRimGlow(material: MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
       float dbRimNdotV = saturate(dot(normalize(normal), normalize(vViewPosition)));
       totalEmissiveRadiance += vec3(0.5, 0.6, 0.8) * 0.14 * pow(1.0 - dbRimNdotV, 3.0);`,
    );
  };
  material.customProgramCacheKey = () => "depthbreaker-rim";
}

function keepRuntimeTrack(track: KeyframeTrack, _clipName: string): boolean {
  if (!track.name.endsWith(".position")) return true;
  // Runtime movement is server-authoritative, so strip only root motion.
  // Hips/pelvis translation is authored pose data in the Dungeon Realms rig;
  // removing it makes locomotion and combat look broken.
  return !["root.position", "Root.position"].includes(track.name);
}
