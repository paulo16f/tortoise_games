import { describe, expect, it } from "vitest";
import {
  addArpgItem,
  buyArpgItem,
  createArpgInventory,
  equipArpgItem,
  rollArpgLoot,
  sellArpgItem,
  useArpgPotion,
} from "../arpgMvp.js";
import { DeterministicRng } from "../rng.js";

describe("arpgMvp", () => {
  it("buys, uses and sells items through the lightweight economy", () => {
    const inv = createArpgInventory("mage");
    expect(buyArpgItem(inv, "apothecary", "health_potion")).toBe(true);
    expect(inv.gold).toBe(52);
    const used = useArpgPotion(inv, 20, 100);
    expect(used).toEqual({ ok: true, hp: 65 });
    expect(addArpgItem(inv, "cracked_charm", 1)).toBe(true);
    expect(sellArpgItem(inv, "cracked_charm")).toBe(true);
    expect(inv.gold).toBe(60);
  });

  it("equips weapons only when the class is allowed", () => {
    const mage = createArpgInventory("mage");
    addArpgItem(mage, "ember_blade", 1);
    expect(equipArpgItem(mage, "mage", "ember_blade")).toBe(false);
    addArpgItem(mage, "storm_staff", 1);
    expect(equipArpgItem(mage, "mage", "storm_staff")).toBe(true);
    expect(mage.equipment.weapon).toBe("storm_staff");
  });

  it("equips bags as capacity upgrades", () => {
    const inv = createArpgInventory("warden");
    addArpgItem(inv, "small_bag", 1);
    expect(equipArpgItem(inv, "warden", "small_bag")).toBe(true);
    expect(inv.bonusCapacity).toBe(6);
  });

  it("boss rewards always grant gold and may grant high rarity items", () => {
    const rng = new DeterministicRng(1234);
    const reward = rollArpgLoot(rng, "boss");
    expect(reward.gold).toBeGreaterThanOrEqual(80);
    expect(reward.gold).toBeLessThanOrEqual(140);
    expect(reward.itemId).not.toBeNull();
  });
});
