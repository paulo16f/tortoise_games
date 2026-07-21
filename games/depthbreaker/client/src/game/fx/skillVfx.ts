// Per-skill visual-effect registry — the data-driven look of every skill, keyed
// by the `skillId` the server now stamps on each combat event (see
// CombatEventMessage.skillId). Consumers: ImpactFx (impact burst), Projectiles
// (bolt colour), SkillGroundFx (ground rings/pools/novas + cast flashes). Pure
// data + a lookup; add/retune a skill by editing one entry here — no render code.
//
// The user can later drop flipbook/texture art and reference it from a `texture`
// field added here; procedural specs below need no art.

/** A flipbook sprite sheet (from tools/video_to_flipbook.mjs — Higgsfield
 *  clips on pure black; black vanishes under additive blending). */
export interface SheetSpec {
  url: string;
  cols: number;
  rows: number;
  fps: number;
  /** World-units size of the quad (default 2.2). */
  size?: number;
}

export interface ImpactSpec {
  /** Optional flipbook played at the impact point (billboard). */
  sheet?: SheetSpec;
  count: number;
  color: string;
  speed: number;
  size: number;
  life: number;
  up?: number;
}

export interface ProjectileSpec {
  /** Emissive body colour. */
  color: string;
  /** Optional bright core colour (defaults to a hot white-ish tint). */
  core?: string;
  /** Body radius (world units). */
  size?: number;
  /** Trail tint; when set the bolt leaves a short additive trail. */
  trail?: string;
}

export type GroundKind = "ring" | "pool" | "nova" | "arc" | "shout";

export interface GroundSpec {
  /** Optional flipbook laid flat at the anchor (plays alongside the shape). */
  sheet?: SheetSpec;
  kind: GroundKind;
  color: string;
  /** Target outer radius in world units. */
  radius: number;
  /** Lifetime seconds (default per-kind). */
  life?: number;
  /** Anchor the effect at the caster or at the event target. */
  at: "caster" | "target";
}

export interface VfxSpec {
  /** Overrides the generic per-kind impact spark burst. */
  impact?: Partial<ImpactSpec>;
  /** Bolt look for projectile skills. */
  projectile?: ProjectileSpec;
  /** A flat ground effect (ring/pool/nova/arc/shout). */
  ground?: GroundSpec;
  /** A brief flash at the caster on the cast event (amount 0, self-targeted). */
  cast?: { color: string; sheet?: SheetSpec };
}

const HOLY = "#ffe27a";
const HOLY_SOFT = "#fff3c0";
const HEAL = "#86efac";
const FIRE = "#ff8c2a";
const FROST = "#9fe8ff";
const SHADOW = "#9b5cff";
const STEEL = "#dbeafe";
const BLOOD = "#c0342b";

/**
 * Skill id → look. Skills absent here fall back to the generic per-`kind` FX
 * (the pre-registry behaviour), so partial coverage is safe.
 */
export const SKILL_VFX: Record<string, VfxSpec> = {
  // --- Necromancer ---
  fireball: {
    impact: { count: 16, color: FIRE, speed: 4.6, size: 0.18, life: 0.5, up: 1.8 },
    projectile: { color: FIRE, core: "#fff3c0", size: 0.22, trail: "#ff5a1a" },
    ground: { kind: "pool", color: "#ff6a1a", radius: 3.0, at: "target", life: 0.55 },
  },
  frost_nova: {
    impact: { count: 6, color: "#bfefff", speed: 2.6, size: 0.12, life: 0.32 },
    ground: { kind: "ring", color: FROST, radius: 5.0, at: "caster", life: 0.7 },
    cast: { color: FROST },
  },
  corruption: {
    impact: { count: 8, color: SHADOW, speed: 2.2, size: 0.13, life: 0.42 },
    ground: { kind: "pool", color: "#6b2fb3", radius: 1.5, at: "target", life: 1.0 },
  },
  drain_life: {
    impact: { count: 9, color: "#7cf5b1", speed: 2.4, size: 0.13, life: 0.42, up: 1.2 },
    cast: { color: SHADOW },
  },
  bone_spear: {
    impact: { count: 13, color: "#e7e5e4", speed: 4.4, size: 0.15, life: 0.4, up: 1.6 },
    projectile: { color: "#e7e5e4", core: "#ffffff", size: 0.18, trail: "#a8a29e" },
  },
  bone_armor: { ground: { kind: "shout", color: "#d6d3d1", radius: 1.8, at: "caster" }, cast: { color: "#d6d3d1" } },

  // --- Cleric ---
  smite: {
    impact: { count: 12, color: HOLY_SOFT, speed: 3.8, size: 0.16, life: 0.42 },
    projectile: { color: HOLY, core: "#ffffff", size: 0.2, trail: HOLY },
    ground: { kind: "nova", color: HOLY, radius: 1.6, at: "target" },
  },
  mend: { ground: { kind: "nova", color: HEAL, radius: 1.5, at: "target" }, cast: { color: HEAL } },
  renew: { ground: { kind: "nova", color: HEAL, radius: 1.5, at: "target" }, cast: { color: HEAL } },
  blessing: { ground: { kind: "shout", color: "#fde68a", radius: 1.8, at: "caster" }, cast: { color: "#fde68a" } },
  holy_nova: {
    impact: { count: 10, color: HOLY_SOFT, speed: 3.4, size: 0.14, life: 0.38 },
    ground: { kind: "nova", color: HOLY, radius: 3.5, at: "caster" },
    cast: { color: HOLY },
  },
  sanctuary: { ground: { kind: "ring", color: HOLY, radius: 2.0, at: "caster", life: 0.6 }, cast: { color: HOLY } },

  // --- Knight ---
  cleave: {
    impact: { count: 7, color: "#fecaca", speed: 3.4, size: 0.13, life: 0.32 },
    ground: { kind: "arc", color: "#fecaca", radius: 4.4, at: "caster" },
  },
  whirlwind: {
    impact: { count: 8, color: STEEL, speed: 3.6, size: 0.13, life: 0.34 },
    ground: { kind: "arc", color: STEEL, radius: 3.5, at: "caster" },
  },
  taunt: { ground: { kind: "shout", color: "#fca5a5", radius: 8, at: "caster" }, cast: { color: "#fca5a5" } },
  shield_wall: { cast: { color: "#facc15" } },
  bulwark: { cast: { color: "#93c5fd" } },
  execute: { impact: { count: 15, color: "#ef4444", speed: 4.6, size: 0.17, life: 0.5, up: 2.2 } },

  // --- Reaper ---
  soul_reap: {
    impact: { count: 11, color: BLOOD, speed: 3.6, size: 0.15, life: 0.44 },
  },
  rupture: {
    impact: { count: 10, color: BLOOD, speed: 3.2, size: 0.14, life: 0.4 },
    ground: { kind: "pool", color: BLOOD, radius: 1.3, at: "target", life: 0.9 },
  },
  charge: { impact: { count: 8, color: "#fbbf24", speed: 4.0, size: 0.14, life: 0.34 } },

  // --- Auto-attack (staff casters get a soft bolt; melee gets a light spark) ---
  basic_attack: {
    impact: { count: 5, color: "#fde68a", speed: 3.0, size: 0.1, life: 0.28 },
    projectile: { color: "#c4b5fd", core: "#f5f3ff", size: 0.16, trail: "#a78bfa" },
  },
};

export function vfxFor(skillId: string): VfxSpec | undefined {
  return skillId ? SKILL_VFX[skillId] : undefined;
}
