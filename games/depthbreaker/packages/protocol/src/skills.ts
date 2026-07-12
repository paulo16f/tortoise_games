// Data-driven skill content shared by the realtime server (effect execution),
// the client (hotbar + skill book UI), and tests. Modeled on
// world-of-claudecraft's ability system: a flat SKILLS map of plain-data defs,
// an ordered per-class kit list, and skillsKnownAt() as the single
// learn-by-level resolver. Behavior is declarative data — the server's
// runEffects switch in ZoneRoom is the only place effects execute.

import type { ClassId } from "./constants.js";

/** Number of hotbar slots; keys 1-9,0 map to slots 0-9. */
export const HOTBAR_SLOTS = 10;

/**
 * Effect payloads, discriminated by `type` (WoCC AbilityEffect style). A skill
 * carries a list so composite skills (damage + buff) compose without new code.
 * Damage numbers are pre-mitigation raw values fed through resolveDamage.
 */
export type SkillEffect =
  /** Toggle server-authoritative auto-attack on the current target. */
  | { type: "basic_attack" }
  /** Frontal cone melee damage around the caster's facing. */
  | { type: "melee_cone"; range: number; halfAngle: number; damage: number }
  /** Brief full damage immunity on the caster. */
  | { type: "self_immunity"; duration: number }
  /** Instant point-blank AoE burst centered on the caster. */
  | { type: "radial_aoe"; radius: number; damage: number }
  /** Gap-close to the current target, then a single melee hit. */
  | { type: "dash_strike"; range: number; damage: number }
  /** Single-target strike; bonus multiplier when target HP is low. */
  | { type: "execute"; range: number; damage: number; lowHpThreshold: number; bonusMult: number }
  /**
   * Single-target strike that heals the caster for `lifesteal` × damage dealt
   * (Reaper's sustain identity — trades shields for drain).
   */
  | { type: "lifesteal_strike"; range: number; damage: number; lifesteal: number }
  /** Timed self-buff: damage_reduction (mitigate incoming) or damage_amp (boost outgoing). */
  | { type: "self_buff"; kind: "damage_reduction" | "damage_amp"; value: number; duration: number }
  /** Instant self-heal for a fraction of max HP (cleric holy magic). */
  | { type: "heal_self"; fraction: number }
  /**
   * Smart-heal: restore `fraction` of max HP to the most-wounded ally (by HP
   * ratio) within `radius`, including the caster — so it heals a hurt friend in
   * a group and simply heals the cleric when solo.
   */
  | { type: "heal_ally"; fraction: number; radius: number }
  /** Projectile at the current target that explodes in a radius on impact. */
  | { type: "projectile_aoe"; radius: number; damage: number }
  /** Orbiting damage aura ticking on nearby enemies for a duration. */
  | { type: "aura_dot"; radius: number; tick: number; damage: number; duration: number }
  /**
   * Single-target damage-over-time on the current enemy: `damage` every `tick`s
   * for `duration`s (Necromancer's affliction identity). Refreshes on re-cast.
   */
  | { type: "dot"; damage: number; tick: number; duration: number }
  /**
   * Force every enemy within `radius` to attack the caster and spike their
   * threat so they hold aggro for `duration`s (Knight's threat control).
   */
  | { type: "taunt"; radius: number; duration: number };

export interface SkillDef {
  id: string;
  name: string;
  /** Home hotbar slot 0-9 (fixed designer layout; keys 1-9,0). */
  slot: number;
  /** Character level at which the skill unlocks (skills auto-unlock). */
  learnLevel: number;
  /** Seconds between uses; 0 = GCD only. */
  cooldown: number;
  /** True = does not trigger or respect the global cooldown. */
  offGcd?: boolean;
  effects: SkillEffect[];
  /** Short uppercase hotbar label (slot chip). */
  label: string;
  description: string;
}

/** Flat catalog. Kits below decide which class knows which skill. */
export const SKILLS: Record<string, SkillDef> = {
  basic_attack: {
    id: "basic_attack",
    name: "Attack",
    slot: 0,
    learnLevel: 1,
    cooldown: 0,
    offGcd: true,
    effects: [{ type: "basic_attack" }],
    label: "ATK",
    description: "Toggle auto-attack on your current target.",
  },
  cleave: {
    id: "cleave",
    name: "Cleave",
    slot: 1,
    learnLevel: 1,
    cooldown: 7,
    effects: [{ type: "melee_cone", range: 4.4, halfAngle: Math.PI / 3, damage: 28 }],
    label: "CLV",
    description: "Sweep a frontal arc, damaging every enemy caught in it.",
  },
  shield_wall: {
    id: "shield_wall",
    name: "Shield Wall",
    slot: 2,
    learnLevel: 3,
    cooldown: 10,
    // Reactive panic button: off the GCD so you can shield the instant you need
    // it and still act, without eating a global lock (its 10s cooldown gates it).
    offGcd: true,
    effects: [{ type: "self_immunity", duration: 3 }],
    label: "SHLD",
    description: "Raise your shield, blocking all damage for 3s.",
  },
  whirlwind: {
    id: "whirlwind",
    name: "Whirlwind",
    slot: 3,
    learnLevel: 6,
    cooldown: 9,
    effects: [{ type: "radial_aoe", radius: 3.5, damage: 22 }],
    label: "WW",
    description: "Spin in place, striking every enemy around you.",
  },
  charge: {
    id: "charge",
    name: "Charge",
    slot: 4,
    learnLevel: 9,
    cooldown: 9,
    effects: [{ type: "dash_strike", range: 10, damage: 16 }],
    label: "CHG",
    description: "Rush your target and strike on arrival.",
  },
  execute: {
    id: "execute",
    name: "Execute",
    slot: 5,
    learnLevel: 10,
    cooldown: 10,
    effects: [{ type: "execute", range: 3, damage: 30, lowHpThreshold: 0.3, bonusMult: 2 }],
    label: "EXE",
    description: "A killing blow — double damage against wounded enemies.",
  },
  bulwark: {
    id: "bulwark",
    name: "Bulwark",
    slot: 6,
    learnLevel: 15,
    cooldown: 20,
    // Reactive defensive cooldown: off the GCD (its 20s cooldown is the gate).
    offGcd: true,
    effects: [{ type: "self_buff", kind: "damage_reduction", value: 0.4, duration: 6 }],
    label: "BLWK",
    description: "Brace yourself, taking 40% less damage for 6s.",
  },
  fireball: {
    id: "fireball",
    name: "Fireball",
    slot: 1,
    learnLevel: 1,
    cooldown: 6,
    effects: [{ type: "projectile_aoe", radius: 3.2, damage: 24 }],
    label: "FIRE",
    description: "Hurl a fireball that explodes on your target.",
  },
  frost_nova: {
    id: "frost_nova",
    name: "Frost Nova",
    slot: 2,
    learnLevel: 3,
    cooldown: 14,
    effects: [{ type: "aura_dot", radius: 4.0, tick: 0.5, damage: 6, duration: 6 }],
    label: "FRST",
    description: "Orbiting frost shards chill nearby enemies for 6s.",
  },
  // --- Knight: threat control ---
  taunt: {
    id: "taunt",
    name: "Challenging Shout",
    slot: 4,
    learnLevel: 4,
    cooldown: 12,
    effects: [{ type: "taunt", radius: 8, duration: 4 }],
    label: "TAUNT",
    description: "Roar a challenge, forcing nearby enemies to attack you.",
  },
  // --- Reaper: melee drain (no shields; sustains by killing) ---
  soul_reap: {
    id: "soul_reap",
    name: "Soul Reap",
    slot: 2,
    learnLevel: 4,
    cooldown: 7,
    effects: [{ type: "lifesteal_strike", range: 3, damage: 22, lifesteal: 0.7 }],
    label: "REAP",
    description: "Tear at your target, healing you for 70% of the damage dealt.",
  },
  // --- Cleric: holy magic — sustain (mend/renew), damage (smite), buff (blessing) ---
  mend: {
    id: "mend",
    name: "Mend",
    slot: 1,
    learnLevel: 1,
    cooldown: 8,
    effects: [{ type: "heal_self", fraction: 0.35 }],
    label: "MEND",
    description: "Channel holy light, restoring 35% of your health.",
  },
  smite: {
    id: "smite",
    name: "Smite",
    slot: 2,
    learnLevel: 1,
    cooldown: 4,
    effects: [{ type: "projectile_aoe", radius: 1.6, damage: 18 }],
    label: "SMTE",
    description: "Hurl a bolt of holy light that sears your target.",
  },
  renew: {
    id: "renew",
    name: "Renew",
    slot: 3,
    learnLevel: 3,
    cooldown: 6,
    effects: [{ type: "heal_ally", fraction: 0.25, radius: 12 }],
    label: "RNEW",
    description: "Mend the most wounded ally near you (or yourself) for 25% health.",
  },
  blessing: {
    id: "blessing",
    name: "Blessing",
    slot: 5,
    learnLevel: 6,
    cooldown: 16,
    effects: [{ type: "self_buff", kind: "damage_amp", value: 0.35, duration: 8 }],
    label: "BLES",
    description: "Empower yourself, dealing 35% more damage for 8s.",
  },
  // --- Necromancer: affliction — a single-target damage-over-time curse ---
  corruption: {
    id: "corruption",
    name: "Corruption",
    slot: 3,
    learnLevel: 5,
    cooldown: 8,
    effects: [{ type: "dot", damage: 7, tick: 1, duration: 8 }],
    label: "CORR",
    description: "Curse your target, draining 7 health every second for 8s.",
  },
};

/**
 * Ordered per-class kits (learn order). Kits are the authority on who knows what
 * — defs are shared, so classes can reuse the same skill in different kits.
 * Four Dark Fortress heroes, each with a distinct identity:
 *   Knight — defensive tank: shields, AoE, and a taunt to hold threat.
 *   Reaper — offensive melee: gap-close + lifesteal drain, no shields.
 *   Cleric — holy hybrid: ranged smite damage + self/ally heals + a damage buff,
 *            deliberately solo-viable (kills on its own) as well as a group healer.
 *   Necromancer — ranged caster: burst (fireball), affliction (corruption DoT),
 *            and an AoE chill (frost nova).
 */
export const CLASS_KITS: Record<ClassId, readonly string[]> = {
  knight: ["basic_attack", "cleave", "shield_wall", "whirlwind", "taunt", "execute", "bulwark"],
  reaper: ["basic_attack", "cleave", "soul_reap", "whirlwind", "charge", "execute"],
  cleric: ["basic_attack", "smite", "mend", "renew", "blessing"],
  necromancer: ["basic_attack", "fireball", "frost_nova", "corruption"],
};

export function skillDef(id: string): SkillDef | undefined {
  return SKILLS[id];
}

/** The single learn-by-level resolver (WoCC abilitiesKnownAt). */
export function skillsKnownAt(classId: ClassId, level: number): SkillDef[] {
  const out: SkillDef[] = [];
  for (const id of CLASS_KITS[classId] ?? []) {
    const def = SKILLS[id];
    if (def && def.learnLevel <= level) out.push(def);
  }
  return out;
}

/** Full kit regardless of level (skill-book rows show locked entries too). */
export function classKit(classId: ClassId): SkillDef[] {
  const out: SkillDef[] = [];
  for (const id of CLASS_KITS[classId] ?? []) {
    const def = SKILLS[id];
    if (def) out.push(def);
  }
  return out;
}

/**
 * Fixed slot→skillId layout, length HOTBAR_SLOTS; "" marks an empty slot.
 * Every kit skill sits at its def's home slot (locked ones render greyed).
 */
export function hotbarLayout(classId: ClassId): string[] {
  const layout = Array.from({ length: HOTBAR_SLOTS }, () => "");
  for (const def of classKit(classId)) {
    if (def.slot >= 0 && def.slot < HOTBAR_SLOTS && layout[def.slot] === "") {
      layout[def.slot] = def.id;
    }
  }
  return layout;
}
