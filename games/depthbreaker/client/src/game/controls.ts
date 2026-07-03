// Shared client-side control state: held movement keys and camera orbit.
// Populated by window event listeners (see useControls) and read every frame
// by the camera rig and the input sender. Kept as a plain mutable singleton so
// per-frame reads never touch React state.

export interface OrbitState {
  /** Horizontal orbit angle (radians). Follows behind the player at 0. */
  yaw: number;
  /** Vertical angle (radians), clamped to keep the camera above ground. */
  pitch: number;
  /** Distance from the player, clamped between MIN_ZOOM and MAX_ZOOM. */
  distance: number;
}

export interface ControlState {
  keys: Set<string>;
  orbit: OrbitState;
  dragging: boolean;
}

export const MIN_ZOOM = 4;
export const MAX_ZOOM = 24;
export const MIN_PITCH = 0.15;
export const MAX_PITCH = 1.35;

export const controlState: ControlState = {
  keys: new Set<string>(),
  orbit: { yaw: 0, pitch: 0.6, distance: 12 },
  dragging: false,
};

/** Movement key codes we care about (WASD + arrows). */
const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

export function isMoveKey(code: string): boolean {
  return MOVE_KEYS.has(code);
}

/**
 * Compute camera-relative planar move direction from held keys and the current
 * orbit yaw. W moves away from the camera. Returns a normalized-ish vector with
 * each component in [-1, 1].
 */
export function computeMove(state: ControlState): { moveX: number; moveZ: number } {
  const k = state.keys;
  let forward = 0;
  let strafe = 0;
  if (k.has("KeyW") || k.has("ArrowUp")) forward += 1;
  if (k.has("KeyS") || k.has("ArrowDown")) forward -= 1;
  if (k.has("KeyD") || k.has("ArrowRight")) strafe += 1;
  if (k.has("KeyA") || k.has("ArrowLeft")) strafe -= 1;

  if (forward === 0 && strafe === 0) return { moveX: 0, moveZ: 0 };

  // Camera looks toward -Z rotated by orbit.yaw. Forward in world space:
  const yaw = state.orbit.yaw;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // Forward vector (into the screen away from camera): (-sin, -cos) in XZ? We
  // define: forward = (sin*? ...). Use standard: camera behind player along
  // +Z rotated by yaw. Forward direction the player should move:
  const fx = -sin;
  const fz = -cos;
  // Right vector is forward rotated -90deg.
  const rx = cos;
  const rz = -sin;

  let moveX = fx * forward + rx * strafe;
  let moveZ = fz * forward + rz * strafe;

  const len = Math.hypot(moveX, moveZ);
  if (len > 1e-4) {
    moveX /= len;
    moveZ /= len;
  }
  return { moveX, moveZ };
}
