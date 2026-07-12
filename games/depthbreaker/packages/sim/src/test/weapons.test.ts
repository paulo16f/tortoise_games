import { describe, expect, it } from "vitest";
import {
  ITEMS,
  CLASS_WEAPON_TYPES,
  canEquipWeapon,
  weaponAttackSpeed,
  weaponCritBonus,
  weaponReach,
  weaponTypeOf,
} from "../items.js";

const weapons = Object.values(ITEMS).filter((i) => i.kind === "weapon");

describe("weapon system", () => {
  it("every weapon has a valid archetype and sane stats", () => {
    for (const w of weapons) {
      expect(w.weaponType, w.id).toBeDefined();
      expect(w.attackSpeed ?? 1, w.id).toBeGreaterThan(0);
      expect(w.critBonus ?? 0, w.id).toBeGreaterThanOrEqual(0);
      expect(w.critBonus ?? 0, w.id).toBeLessThan(1);
    }
  });

  it("helpers read weapon stats with safe defaults", () => {
    expect(weaponTypeOf("iron_dagger")).toBe("dagger");
    expect(weaponAttackSpeed("iron_dagger")).toBe(1.4);
    expect(weaponCritBonus("iron_dagger")).toBe(0.08);
    expect(weaponReach("iron_dagger")).toBe(-0.4);
    expect(weaponReach("war_spear")).toBe(1.2);
    // Unknown / non-weapon ids fall back cleanly.
    expect(weaponAttackSpeed("nope")).toBe(1);
    expect(weaponCritBonus("health_potion")).toBe(0);
    expect(weaponTypeOf("iron_ore")).toBeUndefined();
  });

  it("class gating follows the weapon archetype", () => {
    // Necromancer: staff/wand only.
    expect(canEquipWeapon("necromancer", "ash_staff")).toBe(true);
    expect(canEquipWeapon("necromancer", "apprentice_wand")).toBe(true);
    expect(canEquipWeapon("necromancer", "iron_sword")).toBe(false);
    expect(canEquipWeapon("necromancer", "dwarven_axe")).toBe(false);
    // Knight: melee types, no staves.
    expect(canEquipWeapon("knight", "war_hammer")).toBe(true);
    expect(canEquipWeapon("knight", "iron_dagger")).toBe(true);
    expect(canEquipWeapon("knight", "ash_staff")).toBe(false);
    // Cleric: mace/staff — no swords, axes, or daggers.
    expect(canEquipWeapon("cleric", "storm_staff")).toBe(true);
    expect(canEquipWeapon("cleric", "iron_dagger")).toBe(false);
    expect(canEquipWeapon("cleric", "dwarven_axe")).toBe(false);
    // Reaper: heavy melee — no staves or daggers.
    expect(canEquipWeapon("reaper", "war_hammer")).toBe(true);
    expect(canEquipWeapon("reaper", "iron_dagger")).toBe(false);
    // Non-weapons are never equippable.
    expect(canEquipWeapon("knight", "health_potion")).toBe(false);
  });

  it("every class can wield its starter weapon", () => {
    expect(canEquipWeapon("knight", "iron_sword")).toBe(true);
    expect(canEquipWeapon("reaper", "iron_sword")).toBe(true);
    expect(canEquipWeapon("cleric", "ash_staff")).toBe(true);
    expect(canEquipWeapon("necromancer", "ash_staff")).toBe(true);
    for (const c of Object.keys(CLASS_WEAPON_TYPES) as (keyof typeof CLASS_WEAPON_TYPES)[]) {
      expect(CLASS_WEAPON_TYPES[c].length).toBeGreaterThan(0);
    }
  });
});
