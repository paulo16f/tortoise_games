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

const CLASS_IDS: ClassId[] = ["bruiser", "mage", "warden"];

describe("skill catalog integrity", () => {
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
    const layout = hotbarLayout("mage");
    for (const id of layout) {
      if (id !== "") expect(skillDef(id)).toBeDefined();
    }
    expect(layout.filter((id) => id === "").length).toBeGreaterThan(0);
  });
});

describe("skillsKnownAt (learn-by-level)", () => {
  it("level 1 excludes higher learnLevel skills", () => {
    const known = skillsKnownAt("bruiser", 1);
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
