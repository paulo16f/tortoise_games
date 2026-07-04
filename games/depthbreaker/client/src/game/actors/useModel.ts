// GLB model registry for animated character assets.

import { useGLTF } from "@react-three/drei";
import type { ClassId } from "@depthbreaker/protocol";
import { MELEE_CLIPS, CASTER_CLIPS, type ClipSet } from "./AnimatedCharacter";
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
}

const KNIGHT = "/models/kaykit/characters/kaykit_knight.glb";
const MAGE = "/models/kaykit/characters/kaykit_mage.glb";
const SKELETON_WARRIOR = "/models/kaykit/characters/kaykit_skeleton_warrior.glb";
const SKELETON_MINION = "/models/kaykit/characters/kaykit_skeleton_minion.glb";
const SWORD = "/models/kaykit/weapons/kaykit_sword.gltf";

const SYNTY_KNIGHT = "/models/synty/characters/sk_dungeon_knight_male.glb";
const SYNTY_WARRIOR = "/models/synty/characters/sk_adventure_warrior.glb";
const SYNTY_WIZARD = "/models/synty/characters/sk_fantasy_wizard.glb";
const SYNTY_SKELETON = "/models/synty/characters/sk_dungeon_skeleton_soldier.glb";
const SYNTY_GOBLIN_CHIEF = "/models/synty/characters/sk_dungeon_goblin_chief.glb";
const SYNTY_ROCK_GOLEM = "/models/synty/characters/sk_dungeon_rock_golem.glb";
const SYNTY_SWORD = "/models/synty/weapons/prop_sword.glb";
const SYNTY_STAFF = "/models/synty/weapons/prop_staff.glb";
const SYNTY_SHIELD = "/models/synty/weapons/prop_shield_knight.glb";

const SYNTY_DB_WARRIOR = "/models/synty/depthbreaker/characters/warrior.glb";
const SYNTY_DB_MAGE = "/models/synty/depthbreaker/characters/mage.glb";
const SYNTY_DB_SKELETON = "/models/synty/depthbreaker/characters/skeleton.glb";
const SYNTY_DB_GOBLIN_CHIEF = "/models/synty/depthbreaker/characters/goblin_chief.glb";
const SYNTY_DB_ROCK_GOLEM = "/models/synty/depthbreaker/characters/rock_golem.glb";
const SYNTY_DB_SWORD = "/models/synty/depthbreaker/weapons/sword.glb";
const SYNTY_DB_STAFF = "/models/synty/depthbreaker/weapons/staff.glb";

const SYNTY_DEPTHBREAKER_CLIPS: ClipSet = {
  idle: "idle",
  run: "run",
  attack: "attack",
  hit: "hit",
  death: "death",
};

// Raw Synty Mini Fantasy conversions are kept for preview/reference. The
// depthbreaker set below is the runtime-ready version with named clips.
export const SYNTY_MODELS = {
  warrior: { url: SYNTY_WARRIOR, weaponUrl: SYNTY_SWORD, handBoneNames: ["hand_r"], clips: MELEE_CLIPS, targetHeight: 1.85, visualHeight: 1.85, radius: 0.45 },
  knight: { url: SYNTY_KNIGHT, weaponUrl: SYNTY_SWORD, handBoneNames: ["hand_r"], clips: MELEE_CLIPS, targetHeight: 1.85, visualHeight: 1.85, radius: 0.45 },
  wizard: { url: SYNTY_WIZARD, weaponUrl: SYNTY_STAFF, handBoneNames: ["hand_r"], clips: CASTER_CLIPS, targetHeight: 1.85, visualHeight: 1.85, radius: 0.45 },
  skeleton: { url: SYNTY_SKELETON, weaponUrl: SYNTY_SWORD, handBoneNames: ["hand_r"], clips: MELEE_CLIPS, targetHeight: 1.8, visualHeight: 1.8, radius: 0.45 },
  goblinChief: { url: SYNTY_GOBLIN_CHIEF, weaponUrl: SYNTY_SWORD, handBoneNames: ["hand_r"], clips: MELEE_CLIPS, targetHeight: 2.1, visualHeight: 2.1, radius: 0.55 },
  rockGolem: { url: SYNTY_ROCK_GOLEM, handBoneNames: ["hand_r"], clips: MELEE_CLIPS, targetHeight: 3.0, visualHeight: 3.0, radius: 0.8 },
} satisfies Record<string, CharacterModel>;

export const SYNTY_DEPTHBREAKER_MODELS = {
  warrior: { url: SYNTY_DB_WARRIOR, weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["hand_r"], clips: SYNTY_DEPTHBREAKER_CLIPS, targetHeight: 1.15, visualHeight: 1.15, radius: 0.42, weaponTransform: { scale: 0.62, rotation: [0, 0, -0.35], position: [0.02, 0, 0.02] } },
  mage: { url: SYNTY_DB_MAGE, weaponUrl: SYNTY_DB_STAFF, handBoneNames: ["hand_r"], clips: SYNTY_DEPTHBREAKER_CLIPS, targetHeight: 1.15, visualHeight: 1.15, radius: 0.42, weaponTransform: { scale: 0.58, rotation: [0.2, 0, -0.2], position: [0.02, 0, 0.03] } },
  skeleton: { url: SYNTY_DB_SKELETON, weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["hand_r"], clips: SYNTY_DEPTHBREAKER_CLIPS, targetHeight: 1.05, visualHeight: 1.05, radius: 0.4, weaponTransform: { scale: 0.56, rotation: [0, 0, -0.35], position: [0.02, 0, 0.02] } },
  goblinChief: { url: SYNTY_DB_GOBLIN_CHIEF, weaponUrl: SYNTY_DB_SWORD, handBoneNames: ["hand_r"], clips: SYNTY_DEPTHBREAKER_CLIPS, targetHeight: 1.35, visualHeight: 1.35, radius: 0.5, weaponTransform: { scale: 0.7, rotation: [0, 0, -0.35], position: [0.02, 0, 0.02] } },
  rockGolem: { url: SYNTY_DB_ROCK_GOLEM, handBoneNames: ["hand_r"], clips: SYNTY_DEPTHBREAKER_CLIPS, targetHeight: 1.9, visualHeight: 1.9, radius: 0.75 },
} satisfies Record<string, CharacterModel>;

const KAYKIT_MODELS = {
  knight: { url: KNIGHT, weaponUrl: SWORD, handBoneNames: ["handslot.r", "hand_r"], clips: MELEE_CLIPS, targetHeight: 1.15, visualHeight: 1.15, radius: 0.42, weaponTransform: { scale: 0.75, rotation: [0, 0, -0.35], position: [0, 0, 0] } },
  mage: { url: MAGE, handBoneNames: ["handslot.r", "hand_r"], clips: CASTER_CLIPS, targetHeight: 1.15, visualHeight: 1.15, radius: 0.42 },
  skeleton: { url: SKELETON_WARRIOR, weaponUrl: SWORD, handBoneNames: ["handslot.r", "hand_r"], clips: MELEE_CLIPS, targetHeight: 1.05, visualHeight: 1.05, radius: 0.4, weaponTransform: { scale: 0.68, rotation: [0, 0, -0.35], position: [0, 0, 0] } },
  eliteSkeleton: { url: SKELETON_WARRIOR, weaponUrl: SWORD, handBoneNames: ["handslot.r", "hand_r"], clips: MELEE_CLIPS, targetHeight: 1.35, visualHeight: 1.35, radius: 0.5, weaponTransform: { scale: 0.78, rotation: [0, 0, -0.35], position: [0, 0, 0] } },
  bossSkeleton: { url: SKELETON_MINION, weaponUrl: SWORD, handBoneNames: ["handslot.r", "hand_r"], clips: MELEE_CLIPS, targetHeight: 1.9, visualHeight: 1.9, radius: 0.75, weaponTransform: { scale: 0.95, rotation: [0, 0, -0.35], position: [0, 0, 0] } },
} satisfies Record<string, CharacterModel>;

function syntyCharacterApproved(key: string): boolean {
  return syntyRuntimeManifest.characters.some((character) => character.key === key && character.runtimeApproved);
}

const PLAYER_MODELS: Record<ClassId, CharacterModel> = {
  bruiser: syntyCharacterApproved("warrior") ? SYNTY_DEPTHBREAKER_MODELS.warrior : KAYKIT_MODELS.knight,
  warden: syntyCharacterApproved("warrior") ? SYNTY_DEPTHBREAKER_MODELS.warrior : KAYKIT_MODELS.knight,
  mage: syntyCharacterApproved("mage") ? SYNTY_DEPTHBREAKER_MODELS.mage : KAYKIT_MODELS.mage,
};

const ENEMY_MODELS: Record<string, CharacterModel> = {
  grunt: syntyCharacterApproved("skeleton") ? SYNTY_DEPTHBREAKER_MODELS.skeleton : KAYKIT_MODELS.skeleton,
  elite_grunt: syntyCharacterApproved("goblin_chief") ? SYNTY_DEPTHBREAKER_MODELS.goblinChief : KAYKIT_MODELS.eliteSkeleton,
  boss_brute: syntyCharacterApproved("rock_golem") ? SYNTY_DEPTHBREAKER_MODELS.rockGolem : KAYKIT_MODELS.bossSkeleton,
  minion: syntyCharacterApproved("skeleton") ? SYNTY_DEPTHBREAKER_MODELS.skeleton : KAYKIT_MODELS.skeleton,
};

export function resolvePlayerModel(classId: string): CharacterModel | undefined {
  return PLAYER_MODELS[classId as ClassId];
}

export function resolveEnemyModel(defId: string): CharacterModel | undefined {
  return ENEMY_MODELS[defId];
}

for (const url of new Set<string>([
  KNIGHT,
  MAGE,
  SKELETON_WARRIOR,
  SKELETON_MINION,
  SWORD,
  SYNTY_DB_WARRIOR,
  SYNTY_DB_MAGE,
  SYNTY_DB_SKELETON,
  SYNTY_DB_GOBLIN_CHIEF,
  SYNTY_DB_ROCK_GOLEM,
  SYNTY_DB_SWORD,
  SYNTY_DB_STAFF,
])) {
  useGLTF.preload(url);
}
