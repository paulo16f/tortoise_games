// Shared terrain-height lookup for world objects that place themselves at fixed
// (x,z) but must sit ON the elevated official-map floor instead of at y=0. The
// official map is deterministic (seed-independent), so we build it once. On the
// flat procedural map there's no height data → 0, so callers are unchanged there.

import { buildDungeon, groundHeightAt, USE_OFFICIAL_MAP } from "@depthbreaker/protocol";

const GROUND_MAP = USE_OFFICIAL_MAP ? buildDungeon(0, 0) : null;

/** Surface height at (x,z) on the current map — 0 on the flat procedural map. */
export function groundY(x: number, z: number): number {
  return GROUND_MAP ? groundHeightAt(x, z, GROUND_MAP) : 0;
}
