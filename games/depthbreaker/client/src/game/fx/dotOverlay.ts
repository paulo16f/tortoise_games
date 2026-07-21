// Client-inferred "this target is afflicted" tracker — zero protocol changes.
// combatBus skill-damage ticks from DoT skills refresh a short window per target;
// Enemy.tsx reads isAfflicted() in its existing useFrame and pulses a sickly
// emissive while the window is open, so poisons/curses visibly cling.

import { combatBus } from "../../net/combatBus";

/** DoT-ish skills → the overlay colour family. */
const DOT_COLOR: Record<string, string> = {
  corruption: "#a855f7",
  rupture: "#ef4444",
  drain_life: "#8b5cf6",
  renew: "#4ade80", // friendly HoT ticks glow green on players
};

// Ticks arrive ~1/s per DoT; hold a bit longer so the glow doesn't strobe.
const HOLD_MS = 1600;

const afflicted = new Map<string, { until: number; color: string }>();

let wired = false;
export function initDotOverlay(): void {
  if (wired) return;
  wired = true;
  combatBus.subscribe((f) => {
    if (f.kind !== "skill" && f.kind !== "heal") return;
    const color = DOT_COLOR[f.skillId];
    if (!color || f.amount <= 0) return;
    afflicted.set(f.targetId, { until: performance.now() + f.delayMs + HOLD_MS, color });
  });
}

/** The affliction colour for an entity, or null when clean/expired. */
export function afflictionColor(entityId: string): string | null {
  const a = afflicted.get(entityId);
  if (!a) return null;
  if (performance.now() > a.until) {
    afflicted.delete(entityId);
    return null;
  }
  return a.color;
}
