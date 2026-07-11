// Pure bag math: a bag is a flat InvSlot[] with an external capacity (max slot
// count). Stack-aware add tops up existing stacks before appending. Ported from
// the legacy arpgMvp prototype; no ctx, no side effects beyond the passed array.

import { stackSizeOf } from "./items.js";

export interface InvSlot {
  itemId: string;
  count: number;
}

/**
 * Add `n` of `itemId` to the bag, respecting per-item stack size and the slot
 * `capacity`. Tops up existing stacks first, then appends new slots. Returns the
 * leftover count that did not fit (0 when everything fit). Never destroys or
 * merges beyond stack size.
 */
export function addStacked(bag: InvSlot[], capacity: number, itemId: string, n = 1): number {
  const stackSize = stackSizeOf(itemId);
  let remaining = n;
  if (stackSize > 1) {
    for (const slot of bag) {
      if (slot.itemId !== itemId || slot.count >= stackSize) continue;
      const moved = Math.min(remaining, stackSize - slot.count);
      slot.count += moved;
      remaining -= moved;
      if (remaining <= 0) return 0;
    }
  }
  while (remaining > 0) {
    if (bag.length >= capacity) return remaining;
    const moved = Math.min(remaining, stackSize);
    bag.push({ itemId, count: moved });
    remaining -= moved;
  }
  return 0;
}

/** Remove up to `n` from the slot at `index`. Returns true if anything removed. */
export function removeAt(bag: InvSlot[], index: number, n = 1): boolean {
  const slot = bag[index];
  if (!slot || n <= 0) return false;
  const removed = Math.min(n, slot.count);
  slot.count -= removed;
  if (slot.count <= 0) bag.splice(index, 1);
  return removed > 0;
}

/** Remove `n` of `itemId` walking from the end. Returns true only if all n removed. */
export function removeStacked(bag: InvSlot[], itemId: string, n = 1): boolean {
  let remaining = n;
  for (let i = bag.length - 1; i >= 0; i--) {
    const slot = bag[i]!;
    if (slot.itemId !== itemId) continue;
    const removed = Math.min(remaining, slot.count);
    slot.count -= removed;
    remaining -= removed;
    if (slot.count <= 0) bag.splice(i, 1);
    if (remaining <= 0) return true;
  }
  return false;
}

/** Total count of an item id across all stacks. */
export function countItem(bag: InvSlot[], itemId: string): number {
  let total = 0;
  for (const slot of bag) if (slot.itemId === itemId) total += slot.count;
  return total;
}
