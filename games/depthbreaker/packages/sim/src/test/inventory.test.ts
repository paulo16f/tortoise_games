import { describe, expect, it } from "vitest";
import { addStacked, removeAt, removeStacked, countItem, type InvSlot } from "../inventory.js";

const CAP = 4;

describe("addStacked", () => {
  it("tops up an existing stack before appending", () => {
    const bag: InvSlot[] = [{ itemId: "health_potion", count: 18 }];
    const leftover = addStacked(bag, CAP, "health_potion", 5);
    expect(leftover).toBe(0);
    // stackSize 20 -> first stack fills to 20, remainder spills to a new slot
    expect(bag).toEqual([
      { itemId: "health_potion", count: 20 },
      { itemId: "health_potion", count: 3 },
    ]);
  });

  it("keeps weapons (stackSize 1) in separate single slots", () => {
    const bag: InvSlot[] = [];
    addStacked(bag, CAP, "ember_blade", 1);
    addStacked(bag, CAP, "ember_blade", 1);
    expect(bag).toEqual([
      { itemId: "ember_blade", count: 1 },
      { itemId: "ember_blade", count: 1 },
    ]);
  });

  it("returns leftover and never destroys existing items when full", () => {
    const bag: InvSlot[] = [
      { itemId: "cracked_charm", count: 1 },
      { itemId: "ember_blade", count: 1 },
      { itemId: "storm_staff", count: 1 },
      { itemId: "oathbreaker", count: 1 },
    ];
    const leftover = addStacked(bag, CAP, "bread", 3);
    expect(leftover).toBe(3);
    expect(bag).toHaveLength(4);
  });

  it("unknown ids never merge (stackSize defaults to 1)", () => {
    const bag: InvSlot[] = [];
    addStacked(bag, CAP, "mystery", 1);
    addStacked(bag, CAP, "mystery", 1);
    expect(bag).toHaveLength(2);
  });
});

describe("removeStacked / removeAt / countItem", () => {
  it("removes across stacks from the end and reports success only if all removed", () => {
    const bag: InvSlot[] = [
      { itemId: "health_potion", count: 20 },
      { itemId: "health_potion", count: 5 },
    ];
    expect(removeStacked(bag, "health_potion", 8)).toBe(true);
    expect(countItem(bag, "health_potion")).toBe(17);
  });

  it("removeStacked fails and reports false when not enough", () => {
    const bag: InvSlot[] = [{ itemId: "bread", count: 2 }];
    expect(removeStacked(bag, "bread", 5)).toBe(false);
  });

  it("removeAt drops the slot when emptied", () => {
    const bag: InvSlot[] = [{ itemId: "bread", count: 1 }];
    expect(removeAt(bag, 0, 1)).toBe(true);
    expect(bag).toHaveLength(0);
  });

  it("removeAt is a no-op on an empty index", () => {
    const bag: InvSlot[] = [];
    expect(removeAt(bag, 3, 1)).toBe(false);
  });
});
