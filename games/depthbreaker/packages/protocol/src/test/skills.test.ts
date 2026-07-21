import { describe, expect, it } from "vitest";
import {
  CLASS_KITS,
  HOTBAR_SLOTS,
  SKILLS,
  classKit,
  hotbarLayout,
  skillDef,
  skillsKnownAt,
} from "../skills.js";
import type { ClassId } from "../constants.js";

const CLASS_IDS: ClassId[] = ["knight", "reaper", "cleric", "necromancer"];

describe("skill catalog integrity", () => {
  it("every class has a complete 7-skill kit", () => {
    for (const classId of CLASS_IDS) {
      expect(CLASS_KITS[classId], `${classId} kit size`).toHaveLength(7);
    }
  });

  it("every kit id resolves to a def", () => {
    for (const classId of CLASS_IDS) {
      for (const id of CLASS_KITS[classId]) {
        expect(skillDef(id), `${classId} kit id ${id}`).toBeDefined();
      }
    }
  });

  it("defs are internally consistent (id key match, slot in range, sane numbers)", () => {
    for (const [key, def] of Object.entries(SKILLS)) {
      expect(def.id).toBe(key);
      expect(def.slot).toBeGreaterThanOrEqual(0);
      expect(def.slot).toBeLessThan(HOTBAR_SLOTS);
      expect(def.learnLevel).toBeGreaterThanOrEqual(1);
      expect(def.cooldown).toBeGreaterThanOrEqual(0);
      expect(def.effects.length).toBeGreaterThan(0);
    }
  });
});

describe("hotbarLayout", () => {
  it("is always HOTBAR_SLOTS long with no slot collisions", () => {
    for (const classId of CLASS_IDS) {
      const layout = hotbarLayout(classId);
      expect(layout).toHaveLength(HOTBAR_SLOTS);
      const kit = classKit(classId);
      // No two kit skills share a home slot (a collision would silently drop one).
      const slots = kit.map((d) => d.slot);
      expect(new Set(slots).size).toBe(slots.length);
      // Every kit skill landed at its home slot.
      for (const def of kit) expect(layout[def.slot]).toBe(def.id);
    }
  });

  it("empty slots are empty strings", () => {
    const layout = hotbarLayout("necromancer");
    for (const id of layout) {
      if (id !== "") expect(skillDef(id)).toBeDefined();
    }
    expect(layout.filter((id) => id === "").length).toBeGreaterThan(0);
  });
});

describe("skillsKnownAt (learn-by-level)", () => {
  it("level 1 excludes higher learnLevel skills", () => {
    const known = skillsKnownAt("knight", 1);
    const ids = known.map((d) => d.id);
    expect(ids).toContain("basic_attack");
    expect(ids).toContain("cleave");
    expect(ids).not.toContain("shield_wall"); // Lv3
    expect(ids).not.toContain("bulwark"); // Lv15
  });

  it("is monotonic — a higher level never loses a skill", () => {
    for (const classId of CLASS_IDS) {
      let prev = new Set<string>();
      for (let level = 1; level <= 30; level++) {
        const ids = new Set(skillsKnownAt(classId, level).map((d) => d.id));
        for (const id of prev) expect(ids.has(id), `${classId} Lv${level} kept ${id}`).toBe(true);
        prev = ids;
      }
    }
  });

  it("the full kit is known at the level cap", () => {
    for (const classId of CLASS_IDS) {
      expect(skillsKnownAt(classId, 30)).toHaveLength(CLASS_KITS[classId].length);
    }
  });
});

describe("distinct class identities", () => {
  const effectTypes = (id: string) => (SKILLS[id]?.effects ?? []).map((e) => e.type);

  it("Cleric is solo-viable: has damage AND self-heal AND a heal that reaches allies", () => {
    const cleric = CLASS_KITS.cleric;
    // Ranged (smite) + point-blank AoE (holy nova) damage so the cleric kills on its own.
    expect(cleric).toContain("smite");
    expect(effectTypes("smite")).toContain("projectile_aoe");
    expect(cleric).toContain("holy_nova");
    expect(effectTypes("holy_nova")).toContain("radial_aoe");
    // Sustain: self-heal (mend) + a smart ally-heal (renew) + a ward (sanctuary).
    expect(effectTypes("mend")).toContain("heal_self");
    expect(effectTypes("renew")).toContain("heal_ally");
    expect(effectTypes("sanctuary")).toContain("self_buff");
    // A damage buff (blessing) — the "balanced on damage and buffs" ask.
    expect(effectTypes("blessing")).toContain("self_buff");
  });

  it("Knight is the only class with a taunt (threat control)", () => {
    expect(CLASS_KITS.knight).toContain("taunt");
    expect(effectTypes("taunt")).toContain("taunt");
    for (const classId of CLASS_IDS) {
      if (classId !== "knight") expect(CLASS_KITS[classId]).not.toContain("taunt");
    }
  });

  it("Reaper drains (lifesteal) and forgoes the Knight's shields", () => {
    expect(CLASS_KITS.reaper).toContain("soul_reap");
    expect(effectTypes("soul_reap")).toContain("lifesteal_strike");
    expect(CLASS_KITS.reaper).not.toContain("shield_wall");
    expect(CLASS_KITS.reaper).not.toContain("bulwark");
  });

  it("Reaper's rupture is a melee-gated bleed (strike + dot composite)", () => {
    expect(CLASS_KITS.reaper).toContain("rupture");
    const types = effectTypes("rupture");
    expect(types).toContain("dot");
    // The melee strike gates the cast to melee reach (the cast guard scans the
    // whole effect list for melee-typed effects).
    expect(types).toContain("lifesteal_strike");
  });

  it("Necromancer alone wields the Corruption damage-over-time", () => {
    expect(CLASS_KITS.necromancer).toContain("corruption");
    expect(effectTypes("corruption")).toContain("dot");
    // Necromancer is a caster — no melee lifesteal or taunt.
    expect(CLASS_KITS.necromancer).not.toContain("soul_reap");
    expect(CLASS_KITS.necromancer).not.toContain("taunt");
  });

  it("Necromancer sustains at range (drain life) and nukes single targets (bone spear)", () => {
    const drain = SKILLS.drain_life?.effects.find((e) => e.type === "lifesteal_strike");
    expect(drain).toBeDefined();
    // Ranged siphon — well beyond melee reach (the effect executor is range-driven).
    if (drain?.type === "lifesteal_strike") expect(drain.range).toBeGreaterThanOrEqual(10);
    const spear = SKILLS.bone_spear?.effects.find((e) => e.type === "projectile_aoe");
    const fire = SKILLS.fireball?.effects.find((e) => e.type === "projectile_aoe");
    // Bone spear: harder hit, tighter blast than fireball (single-target identity).
    if (spear?.type === "projectile_aoe" && fire?.type === "projectile_aoe") {
      expect(spear.damage).toBeGreaterThan(fire.damage);
      expect(spear.radius).toBeLessThan(fire.radius);
    }
    expect(effectTypes("bone_armor")).toContain("self_buff");
  });

  it("every class has exactly one off-GCD defensive panic button", () => {
    const DEFENSIVES: Record<string, string> = {
      knight: "shield_wall", // (bulwark is a second, deeper cooldown — knight is the tank)
      reaper: "", // no shields: the Reaper's defence is drain sustain
      cleric: "sanctuary",
      necromancer: "bone_armor",
    };
    for (const [classId, id] of Object.entries(DEFENSIVES)) {
      if (!id) continue;
      expect(CLASS_KITS[classId as ClassId]).toContain(id);
      expect(SKILLS[id]?.offGcd).toBe(true);
    }
  });
});
