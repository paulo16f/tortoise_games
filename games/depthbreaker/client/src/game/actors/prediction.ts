// Client-side movement prediction for the LOCAL player only. The character
// starts moving the instant you click/press instead of waiting a server
// round-trip. The server stays fully authoritative:
//
// - We integrate the SAME move step the server runs (shared PLAYER_SPEED +
//   PLAYER_COLLISION_RADIUS + isDungeonWalkable full/X/Z clamp order from
//   @depthbreaker/protocol), so the predicted path matches what the server will
//   compute for the same inputs.
// - Prediction is ACTIVE ONLY WHILE LOCAL MOVE INTENT EXISTS (held keys or a
//   click destination). Every server-driven movement — auto-attack chase,
//   charge dash, respawn teleport — has zero local input, so it falls through
//   to the normal server-lerp path and can never drift.
// - While active we continuously blend the predicted position toward the
//   server's (gentle ~3/s), and SNAP to it past a large error (the server
//   rejected our movement: rooted cast, knockback). No seq-based rewind — this
//   is a co-op PvE friends build, not an esport.

import { buildDungeon, isDungeonWalkable, PLAYER_SPEED, PLAYER_COLLISION_RADIUS, type DungeonMapDefinition } from "@depthbreaker/protocol";
import { computeMoveIntent } from "../input/controls";

/** Blend rate (per second) pulling the prediction toward the server position. */
const RECONCILE_RATE = 3;
/** Prediction error beyond this = the server disagrees hard; snap to it. */
const SNAP_ERROR = 2.5;

interface PredictionResult {
  x: number;
  z: number;
  /** Facing derived from the intent dir (same formula the server uses). */
  yaw: number;
}

let active = false;
let px = 0;
let pz = 0;
let dungeon: DungeonMapDefinition | null = null;
let dungeonKey = "";

function dungeonFor(seed: number, depth: number): DungeonMapDefinition {
  const key = `${seed}:${depth}`;
  if (!dungeon || dungeonKey !== key) {
    dungeon = buildDungeon(seed, depth);
    dungeonKey = key;
  }
  return dungeon;
}

/**
 * Advance the local prediction one frame. Returns the predicted transform while
 * the player has move intent, or null when inactive (caller uses the normal
 * server-lerp path; any small residual closes through that lerp).
 */
export function predictLocalMovement(
  serverX: number,
  serverZ: number,
  renderedX: number,
  renderedZ: number,
  seed: number,
  depth: number,
  alive: boolean,
  dt: number,
): PredictionResult | null {
  const { moveX, moveZ } = computeMoveIntent(renderedX, renderedZ);
  const len = Math.hypot(moveX, moveZ);
  if (!alive || len < 1e-3) {
    active = false;
    return null;
  }

  if (!active) {
    // Seed from the rendered position so activation never pops.
    px = renderedX;
    pz = renderedZ;
    active = true;
  }

  // Integrate exactly like the server tick: full step, then X-only, then Z-only.
  const d = dungeonFor(seed, depth);
  const nx = moveX / len;
  const nz = moveZ / len;
  const nextX = px + nx * PLAYER_SPEED * dt;
  const nextZ = pz + nz * PLAYER_SPEED * dt;
  if (isDungeonWalkable(nextX, nextZ, PLAYER_COLLISION_RADIUS, d)) {
    px = nextX;
    pz = nextZ;
  } else if (isDungeonWalkable(nextX, pz, PLAYER_COLLISION_RADIUS, d)) {
    px = nextX;
  } else if (isDungeonWalkable(px, nextZ, PLAYER_COLLISION_RADIUS, d)) {
    pz = nextZ;
  }

  // Reconcile against the authority.
  const err = Math.hypot(px - serverX, pz - serverZ);
  if (err > SNAP_ERROR) {
    px = serverX;
    pz = serverZ;
  } else {
    const t = 1 - Math.exp(-RECONCILE_RATE * dt);
    px += (serverX - px) * t;
    pz += (serverZ - pz) * t;
  }

  return { x: px, z: pz, yaw: Math.atan2(nx, nz) };
}
