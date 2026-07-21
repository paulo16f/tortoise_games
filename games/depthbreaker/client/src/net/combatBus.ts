// Imperative pub/sub for combat events. 3D components (swing animations,
// projectiles) subscribe here so per-event reactions bypass React re-renders;
// the HUD/floaters keep reading the throttled snapshot instead.

import type { CombatFloater } from "./room";

export type CombatListener = (floater: CombatFloater) => void;

const listeners = new Set<CombatListener>();

export const combatBus = {
  subscribe(fn: CombatListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(floater: CombatFloater): void {
    for (const fn of listeners) fn(floater);
  },
};
