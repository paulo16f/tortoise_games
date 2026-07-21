import { useRef } from "react";

export interface LocomotionSample {
  /** Smoothed ground speed in world units/second. */
  speed: number;
  /** True while latched as moving (survives brief per-frame speed dips). */
  moving: boolean;
  /** True when render-space movement is mostly opposite the current facing. */
  backwards: boolean;
}

// Ported from world-of-claudecraft's src/render/locomotion.ts. The core idea:
// derive cadence speed from the RENDERED mesh's own per-frame world-position
// delta, not from raw network snapshots. The visible transform is already
// interpolated toward the server position (see Player.tsx / Enemy.tsx), so its
// delta is smooth; sampling the raw 20 Hz snapshot instead gives a staircase
// that disagrees with the visible motion and makes the walk clip flip/reset.
const MOVE_ENTER_SPEED = 0.4; // u/s above which we consider the entity moving
const MOVE_HOLD_TIME = 0.22; // s to stay latched "moving" after speed dips
const SPEED_SMOOTH_RATE = 12; // EMA rate for the cadence-driving speed
const TELEPORT_SPEED = 25; // u/s above this is a snap/respawn, not locomotion

/**
 * Tracks a single entity's locomotion state from successive world positions.
 * Call `update(x, z, dt)` once per frame with the rendered mesh's world XZ.
 */
export function useLocomotion() {
  const prev = useRef<{ x: number; z: number } | null>(null);
  const smoothSpeed = useRef(0);
  const moveHold = useRef(0);
  const movingBackwards = useRef(false);

  const update = (x: number, z: number, dt: number, facing?: number): LocomotionSample => {
    let speed = 0;
    let dx = 0;
    let dz = 0;
    if (prev.current) {
      dx = x - prev.current.x;
      dz = z - prev.current.z;
      speed = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
    }
    prev.current = { x, z };
    if (speed > TELEPORT_SPEED) speed = 0; // a teleport/snap, not a stride

    if (speed > MOVE_ENTER_SPEED) moveHold.current = MOVE_HOLD_TIME;
    else moveHold.current = Math.max(0, moveHold.current - dt);
    const moving = moveHold.current > 0;

    // While latched-but-stalled, hold the last cadence value so footfalls don't
    // lurch toward zero on a single stalled frame.
    if (speed > MOVE_ENTER_SPEED || !moving) {
      smoothSpeed.current += (speed - smoothSpeed.current) * Math.min(1, dt * SPEED_SMOOTH_RATE);
    }

    const dist = Math.hypot(dx, dz);
    if (facing !== undefined && speed > MOVE_ENTER_SPEED && dist > 1e-6) {
      movingBackwards.current = (dx * Math.sin(facing) + dz * Math.cos(facing)) / dist < -0.3;
    } else if (!moving) {
      movingBackwards.current = false;
    }

    return { speed: smoothSpeed.current, moving, backwards: moving && movingBackwards.current };
  };

  return { update };
}
