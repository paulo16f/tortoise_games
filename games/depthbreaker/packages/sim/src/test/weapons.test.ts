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
    // Mage: staff/wand only.
    expect(canEquipWeapon("mage", "ash_staff")).toBe(true);
    expect(canEquipWeapon("mage", "apprentice_wand")).toBe(true);
    expect(canEquipWeapon("mage", "iron_sword")).toBe(false);
    expect(canEquipWeapon("mage", "dwarven_axe")).toBe(false);
    // Bruiser: melee types, no staves.
    expect(canEquipWeapon("bruiser", "war_hammer")).toBe(true);
    expect(canEquipWeapon("bruiser", "iron_dagger")).toBe(true);
    expect(canEquipWeapon("bruiser", "ash_staff")).toBe(false);
    // Warden: sword/mace/staff — no axes or daggers.
    expect(canEquipWeapon("warden", "iron_sword")).toBe(true);
    expect(canEquipWeapon("warden", "storm_staff")).toBe(true);
    expect(canEquipWeapon("warden", "dwarven_axe")).toBe(false);
    // Non-weapons are never equippable.
    expect(canEquipWeapon("bruiser", "health_potion")).toBe(false);
  });

  it("every class can wield its starter weapon", () => {
    expect(canEquipWeapon("bruiser", "iron_sword")).toBe(true);
    expect(canEquipWeapon("warden", "iron_sword")).toBe(true);
    expect(canEquipWeapon("mage", "ash_staff")).toBe(true);
    for (const c of Object.keys(CLASS_WEAPON_TYPES) as (keyof typeof CLASS_WEAPON_TYPES)[]) {
      expect(CLASS_WEAPON_TYPES[c].length).toBeGreaterThan(0);
    }
  });
});
