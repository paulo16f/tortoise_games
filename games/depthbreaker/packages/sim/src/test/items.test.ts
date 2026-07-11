import { describe, expect, it } from "vitest";
import { ITEMS, itemDef, stackSizeOf } from "../items.js";

describe("item catalog economy invariants", () => {
  it("every buyable item is also sellable, and buy > sell (no free-money loop)", () => {
    for (const def of Object.values(ITEMS)) {
      if (def.buyValue !== undefined) {
        expect(def.sellValue, `${def.id} has buyValue but no sellValue`).toBeDefined();
        expect(def.buyValue, `${def.id} buy must exceed sell`).toBeGreaterThan(def.sellValue!);
      }
      if (def.sellValue !== undefined) expect(def.sellValue).toBeGreaterThan(0);
    }
  });

  it("resources exist, stack, and are sellable but never vendor-bought", () => {
    for (const id of ["iron_ore", "crystal_shard"]) {
      const def = itemDef(id);
      expect(def?.kind).toBe("resource");
      expect(stackSizeOf(id)).toBeGreaterThan(1);
      expect(def?.sellValue ?? 0).toBeGreaterThan(0);
      expect(def?.buyValue).toBeUndefined();
    }
  });

  it("ids key their own defs", () => {
    for (const [key, def] of Object.entries(ITEMS)) expect(def.id).toBe(key);
  });
});
