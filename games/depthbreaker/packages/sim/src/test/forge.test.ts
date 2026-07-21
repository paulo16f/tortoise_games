import { describe, expect, it } from "vitest";
import { FORGE_RECIPES, forgeRecipe, repairCost, REPAIR_WEAPON_ID } from "../forge.js";
import { itemDef, itemMaxUses, DEATH_DURABILITY_COST } from "../items.js";

describe("forge recipes", () => {
  it("catalog integrity: unique ids, real items, positive counts + gold fees", () => {
    const ids = new Set<string>();
    for (const r of FORGE_RECIPES) {
      expect(ids.has(r.id), `dup ${r.id}`).toBe(false);
      ids.add(r.id);
      expect(itemDef(r.output), `output ${r.output}`).toBeDefined();
      expect(r.outputCount).toBeGreaterThan(0);
      expect(r.goldCost, `${r.id} gold fee is the sink`).toBeGreaterThan(0);
      for (const input of r.inputs) {
        expect(itemDef(input.itemId), `input ${input.itemId}`).toBeDefined();
        expect(input.count).toBeGreaterThan(0);
      }
    }
    expect(forgeRecipe("forge_trial_key")).toBeDefined();
  });

  it("crafted tools out-last the market starters (the upgrade is real)", () => {
    expect(itemMaxUses("iron_pickaxe")!).toBeGreaterThan(itemMaxUses("rusty_pickaxe")!);
    expect(itemMaxUses("sturdy_rod")!).toBeGreaterThan(itemMaxUses("willow_rod")!);
  });

  it("repair always costs less than replacing via craft (repair is rational)", () => {
    for (const r of FORGE_RECIPES) {
      const max = itemMaxUses(r.output);
      if (max === undefined) continue;
      expect(repairCost(r.output)!).toBeLessThan(r.goldCost + 1);
    }
  });

  it("repair sentinel isn't a real recipe id and non-durability items have no repair cost", () => {
    expect(forgeRecipe(REPAIR_WEAPON_ID)).toBeUndefined();
    expect(repairCost("bread")).toBeUndefined();
    expect(DEATH_DURABILITY_COST).toBeGreaterThan(0);
  });
});
