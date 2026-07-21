import { describe, expect, it } from "vitest";
import { COOKING_RECIPES, cookingRecipe } from "../cooking.js";
import { itemDef } from "../items.js";

describe("cooking recipes", () => {
  it("every recipe output and input references a real item", () => {
    for (const r of COOKING_RECIPES) {
      expect(itemDef(r.output), r.output).toBeDefined();
      expect(r.outputCount).toBeGreaterThan(0);
      expect(r.inputs.length).toBeGreaterThan(0);
      for (const input of r.inputs) {
        expect(itemDef(input.itemId), input.itemId).toBeDefined();
        expect(input.count).toBeGreaterThan(0);
      }
    }
  });

  it("outputs are food that out-heals bread (0.2); inputs are resources", () => {
    const bread = itemDef("bread")!;
    for (const r of COOKING_RECIPES) {
      const out = itemDef(r.output)!;
      expect(out.kind).toBe("food");
      expect(out.healFraction ?? 0).toBeGreaterThan(bread.healFraction ?? 0);
      // Cooked food can't be bought — cooking is the only source.
      expect(out.buyValue).toBeUndefined();
      for (const input of r.inputs) expect(itemDef(input.itemId)!.kind).toBe("resource");
    }
  });

  it("cookingRecipe looks up by id and returns undefined for unknown", () => {
    expect(cookingRecipe("cook_minnow")).toEqual(COOKING_RECIPES[0]);
    expect(cookingRecipe("nope")).toBeUndefined();
  });
});
