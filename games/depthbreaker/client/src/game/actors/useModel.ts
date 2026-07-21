// GLB model registry for animated character assets.

import { useGLTF } from "@react-three/drei";
import type { ClassId } from "@depthbreaker/protocol";
import { skinDef, weaponTypeOf, type WeaponType } from "@depthbreaker/sim";
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
const SYNTY_DB_KNIGHT_F = "/models/synty/depthbreaker/characters/knight_f.glb";
const SYNTY_DB_WARDEN_M = "/models/synty/depthbreaker/characters/warden_m.glb";
const SYNTY_DB_REAPER = "/models/synty/depthbreaker/characters/reaper.glb";
const SYNTY_DB_REAPER_B = "/models/synty/depthbreaker/characters/reaper_b.glb";
const SYNTY_DB_NECRO_B = "/models/synty/depthbreaker/characters/necro_b.glb";
const SYNTY_DB_SWORD = "/models/synty/depthbreaker/weapons/sword.glb";
const SYNTY_DB_STAFF = "/models/synty/depthbreaker/weapons/staff.glb";

/**
 * Weapon archetype -> held GLB. Each archetype now has its own POLYGON model
 * (exported by Depthbreaker/Export Weapon GLBs). Bow keeps the staff fallback:
 * no bow mesh exists in the owned packs yet.
 */
const WEAPON_MODELS: Record<WeaponType, string> = {
  sword: SYNTY_DB_SWORD,
  axe: "/models/synty/depthbreaker/weapons/axe.glb",
  mace: "/models/synty/depthbreaker/weapons/mace.glb",
  hammer: "/models/synty/depthbreaker/weapons/hammer.glb",
  dagger: "/models/synty/depthbreaker/weapons/dagger.glb",
  spear: "/models/synty/depthbreaker/weapons/spear.glb",
  staff: SYNTY_DB_STAFF,
  wand: "/models/synty/depthbreaker/weapons/wand.glb",
  bow: SYNTY_DB_STAFF,
};

/** The GLB to render for an equipped weapon id (undefined if unknown). */
export function resolveWeaponModel(weaponId: string): string | undefined {
  const type = weaponTypeOf(weaponId);
  return type ? WEAPON_MODELS[type] : undefined;
}

// Movement is a single gait: the character SPRINTS whenever it moves (no walk,
// no run tier). We point the controller's one "run" slot at the `sprint` clip
// and leave `walk`/`run` unmapped so they're never played.
const SYNTY_DEPTHBREAKER_CLIPS: ClipSet = {
  idle: "idle",
  run: "sprint",
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
  knightF: makeCharacterModel(SYNTY_DB_KNIGHT_F, "knight_f", "humanoidPlayer", { weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["Hand_R"], targetHeight: 1.8, visualHeight: 1.8, radius: 0.45, weaponTransform: { scale: 0.8, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  wardenM: makeCharacterModel(SYNTY_DB_WARDEN_M, "warden_m", "humanoidPlayer", { weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["Hand_R"], targetHeight: 1.8, visualHeight: 1.8, radius: 0.45, weaponTransform: { scale: 0.8, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  reaper: makeCharacterModel(SYNTY_DB_REAPER, "reaper", "humanoidPlayer", { weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["Hand_R"], targetHeight: 1.9, visualHeight: 1.9, radius: 0.5, weaponTransform: { scale: 0.85, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  reaperB: makeCharacterModel(SYNTY_DB_REAPER_B, "reaper_b", "humanoidPlayer", { weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["Hand_R"], targetHeight: 1.8, visualHeight: 1.8, radius: 0.45, weaponTransform: { scale: 0.8, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
  necroB: makeCharacterModel(SYNTY_DB_NECRO_B, "necro_b", "humanoidPlayer", { weaponUrl: SYNTY_DB_STAFF, handBoneNames: ["Hand_R"], targetHeight: 1.75, visualHeight: 1.75, radius: 0.43, weaponTransform: { scale: 0.78, rotation: [-1.45, -0.35, 0.35], position: [0.02, 0, 0.02] } }),
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

// Playable classes -> character model. Placeholder mapping onto the current
// Dungeon Realms GLBs until the four POLYGON Dark Fortress heroes (knight /
// death_knight / cleric / necromancer) are exported — then each is a one-line
// swap to a new SYNTY_DB_* entry.
const PLAYER_MODELS: Record<ClassId, CharacterModel> = {
  knight: SYNTY_DEPTHBREAKER_MODELS.warrior,
  reaper: SYNTY_DEPTHBREAKER_MODELS.reaper,
  cleric: SYNTY_DEPTHBREAKER_MODELS.warden,
  necromancer: SYNTY_DEPTHBREAKER_MODELS.mage,
};

// defId -> mesh. The three areas' themed enemies reuse the skeleton / undead-
// knight / boss-skeleton meshes for now; when the Dark Fantasy goblin/skeleton/
// demon casts are baked, each is a one-line swap to a new SYNTY_DB_* model.
const M = SYNTY_DEPTHBREAKER_MODELS;
const ENEMY_MODELS: Record<string, CharacterModel> = {
  grunt: M.skeleton,
  elite_grunt: M.undeadKnight,
  boss_brute: M.bossSkeleton,
  minion: M.skeleton,
  // Area 1 — goblins · Area 2 — skeletons · Area 3 — demons
  goblin: M.skeleton, goblin_warrior: M.undeadKnight, goblin_warchief: M.bossSkeleton,
  skeleton_soldier: M.skeleton, skeleton_knight: M.undeadKnight, skeleton_lord: M.bossSkeleton,
  demon_imp: M.skeleton, demon_brute: M.undeadKnight, demon_lord: M.bossSkeleton,
  coliseum_champion: M.bossSkeleton,
};

/** Cosmetic skin id -> the model it renders (SYNTY_DEPTHBREAKER_MODELS key). */
const SKIN_MODELS: Record<string, CharacterModel> = {
  knightF: SYNTY_DEPTHBREAKER_MODELS.knightF,
  wardenM: SYNTY_DEPTHBREAKER_MODELS.wardenM,
  reaperB: SYNTY_DEPTHBREAKER_MODELS.reaperB,
  necroB: SYNTY_DEPTHBREAKER_MODELS.necroB,
  skeleton: SYNTY_DEPTHBREAKER_MODELS.skeleton,
  undeadKnight: SYNTY_DEPTHBREAKER_MODELS.undeadKnight,
  bossSkeleton: SYNTY_DEPTHBREAKER_MODELS.bossSkeleton,
};

export function resolvePlayerModel(classId: string, skinId?: string): CharacterModel | undefined {
  // An equipped "model" skin overrides the class default; the SkinDef.model
  // string (from @depthbreaker/sim SKIN_CATALOG) names the model to render.
  if (skinId) {
    const def = skinDef(skinId);
    if (def?.kind === "model" && def.model && SKIN_MODELS[def.model]) return SKIN_MODELS[def.model];
  }
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
