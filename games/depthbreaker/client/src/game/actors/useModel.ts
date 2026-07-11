// GLB model registry for animated character assets.

import { useGLTF } from "@react-three/drei";
import type { ClassId } from "@depthbreaker/protocol";
import type { ClipSet, StrideNorm } from "./AnimatedCharacter";
import { MOTION_PROFILES, type MotionProfile, type MotionProfileId } from "./motionProfiles";
import syntyRuntimeManifest from "../../../public/models/synty/runtime/manifest.json";

export interface CharacterModel {
  url: string;
  weaponUrl?: string;
  handBoneNames?: string[];
  clips: ClipSet;
  targetHeight: number;
  visualHeight: number;
  radius: number;
  weaponTransform?: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: number;
  };
  // Bind-pose height/foot-offset recorded once offline by
  // tools/validate_synty_runtime.mjs (see runtime/manifest.json). When
  // present, AnimatedCharacter.tsx trusts these instead of measuring a
  // freshly-cloned SkinnedMesh's bounding box at runtime.
  naturalHeight?: number;
  restMinY?: number;
  motionProfile: MotionProfile;
  strideNorm?: StrideNorm;
  locomotionSet?: string;
  walkRuntimeApproved?: boolean;
  runtimeApproved?: boolean;
}

const SYNTY_DB_WARRIOR = "/models/synty/depthbreaker/characters/warrior.glb";
const SYNTY_DB_WARDEN = "/models/synty/depthbreaker/characters/warden.glb";
const SYNTY_DB_MAGE = "/models/synty/depthbreaker/characters/mage.glb";
const SYNTY_DB_SKELETON = "/models/synty/depthbreaker/characters/skeleton.glb";
const SYNTY_DB_UNDEAD_KNIGHT = "/models/synty/depthbreaker/characters/undead_knight.glb";
const SYNTY_DB_BOSS_SKELETON = "/models/synty/depthbreaker/characters/boss_skeleton.glb";
const SYNTY_DB_SWORD = "/models/synty/depthbreaker/weapons/sword.glb";
const SYNTY_DB_STAFF = "/models/synty/depthbreaker/weapons/staff.glb";

const SYNTY_DEPTHBREAKER_CLIPS: ClipSet = {
  idle: "idle",
  walk: "walk",
  run: "run",
  attack: "attack",
  hit: "hit",
  death: "death",
};

type RuntimeManifestCharacter = {
  key: string;
  runtimeApproved?: boolean;
  naturalHeight?: number;
  restMinY?: number;
  assetVersion?: string;
  motionProfile?: MotionProfileId;
  locomotionSet?: string;
  walkRuntimeApproved?: boolean;
  strideNorm?: StrideNorm;
};

function versionedUrl(url: string, version?: string): string {
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

function manifestCharacterConfig(
  key: string,
  fallbackProfile: MotionProfileId,
): { naturalHeight?: number; restMinY?: number; assetVersion?: string; motionProfile: MotionProfile; clips: ClipSet; strideNorm?: StrideNorm; locomotionSet?: string; walkRuntimeApproved?: boolean; runtimeApproved?: boolean } {
  const entry = (syntyRuntimeManifest.characters as RuntimeManifestCharacter[]).find((character) => character.key === key);
  const profileId = entry?.motionProfile ?? fallbackProfile;
  return {
    naturalHeight: entry?.naturalHeight,
    restMinY: entry?.restMinY,
    assetVersion: entry?.assetVersion,
    motionProfile: MOTION_PROFILES[profileId] ?? MOTION_PROFILES[fallbackProfile],
    // All Depthbreaker GLBs bake identical clip names, so the static logical
    // -> GLB map is the source of truth (the manifest's per-character `clips`
    // block is snake_cased metadata, not the camelCase runtime ClipSet).
    clips: SYNTY_DEPTHBREAKER_CLIPS,
    strideNorm: entry?.strideNorm,
    locomotionSet: entry?.locomotionSet,
    walkRuntimeApproved: entry?.walkRuntimeApproved ?? false,
    runtimeApproved: entry?.runtimeApproved ?? false,
  };
}

function characterUrl(baseUrl: string, config: { assetVersion?: string }): string {
  return versionedUrl(baseUrl, config.assetVersion);
}

export const SYNTY_DEPTHBREAKER_MODELS = {
  warrior: makeCharacterModel(SYNTY_DB_WARRIOR, "warrior", "humanoidPlayer", { weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["Hand_R"], targetHeight: 1.8, visualHeight: 1.8, radius: 0.45, weaponTransform: { scale: 0.8, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  warden: makeCharacterModel(SYNTY_DB_WARDEN, "warden", "humanoidPlayer", { weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["Hand_R"], targetHeight: 1.8, visualHeight: 1.8, radius: 0.45, weaponTransform: { scale: 0.8, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  mage: makeCharacterModel(SYNTY_DB_MAGE, "mage", "humanoidPlayer", { weaponUrl: SYNTY_DB_STAFF, handBoneNames: ["Hand_R"], targetHeight: 1.75, visualHeight: 1.75, radius: 0.43, weaponTransform: { scale: 0.78, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  skeleton: makeCharacterModel(SYNTY_DB_SKELETON, "skeleton", "lightEnemy", { weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["Hand_R"], targetHeight: 1.7, visualHeight: 1.7, radius: 0.42, weaponTransform: { scale: 0.72, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  undeadKnight: makeCharacterModel(SYNTY_DB_UNDEAD_KNIGHT, "undead_knight", "eliteEnemy", { weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["Hand_R"], targetHeight: 1.95, visualHeight: 1.95, radius: 0.55, weaponTransform: { scale: 0.85, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  bossSkeleton: makeCharacterModel(SYNTY_DB_BOSS_SKELETON, "boss_skeleton", "heavyBoss", { weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["Hand_R"], targetHeight: 2.35, visualHeight: 2.35, radius: 0.78, weaponTransform: { scale: 1.0, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
} satisfies Record<string, CharacterModel>;

function makeCharacterModel(
  baseUrl: string,
  manifestKey: string,
  fallbackProfile: MotionProfileId,
  model: Omit<CharacterModel, "url" | "clips" | "motionProfile">,
): CharacterModel {
  const config = manifestCharacterConfig(manifestKey, fallbackProfile);
  return {
    ...model,
    ...config,
    url: characterUrl(baseUrl, config),
  };
}

const PLAYER_MODELS: Record<ClassId, CharacterModel> = {
  bruiser: SYNTY_DEPTHBREAKER_MODELS.warrior,
  warden: SYNTY_DEPTHBREAKER_MODELS.warden,
  mage: SYNTY_DEPTHBREAKER_MODELS.mage,
};

const ENEMY_MODELS: Record<string, CharacterModel> = {
  grunt: SYNTY_DEPTHBREAKER_MODELS.skeleton,
  elite_grunt: SYNTY_DEPTHBREAKER_MODELS.undeadKnight,
  boss_brute: SYNTY_DEPTHBREAKER_MODELS.bossSkeleton,
  minion: SYNTY_DEPTHBREAKER_MODELS.skeleton,
};

export function resolvePlayerModel(classId: string): CharacterModel | undefined {
  return PLAYER_MODELS[classId as ClassId];
}

export function resolveEnemyModel(defId: string): CharacterModel | undefined {
  return ENEMY_MODELS[defId];
}

for (const url of new Set<string>([
  SYNTY_DEPTHBREAKER_MODELS.warrior.url,
  SYNTY_DEPTHBREAKER_MODELS.warden.url,
  SYNTY_DEPTHBREAKER_MODELS.mage.url,
  SYNTY_DEPTHBREAKER_MODELS.skeleton.url,
  SYNTY_DEPTHBREAKER_MODELS.undeadKnight.url,
  SYNTY_DEPTHBREAKER_MODELS.bossSkeleton.url,
  SYNTY_DB_SWORD,
  SYNTY_DB_STAFF,
])) {
  useGLTF.preload(url);
}
