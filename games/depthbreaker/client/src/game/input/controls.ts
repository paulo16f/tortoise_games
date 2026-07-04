import { ARPG_CAMERA } from "../world/cameraPreset";

export interface OrbitState {
  yaw: number;
  pitch: number;
  distance: number;
  panX: number;
  panZ: number;
}

export interface ControlState {
  keys: Set<string>;
  orbit: OrbitState;
  dragging: boolean;
}

export const MIN_ZOOM = ARPG_CAMERA.minDistance;
export const MAX_ZOOM = ARPG_CAMERA.maxDistance;

export const controlState: ControlState = {
  keys: new Set<string>(),
  orbit: {
    yaw: ARPG_CAMERA.yaw,
    pitch: ARPG_CAMERA.pitch,
    distance: ARPG_CAMERA.distance,
    panX: 0,
    panZ: 0,
  },
  dragging: false,
};

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

export function computeMove(state: ControlState): { moveX: number; moveZ: number } {
  const k = state.keys;
  let forward = 0;
  let strafe = 0;
  if (k.has("KeyW") || k.has("ArrowUp")) forward += 1;
  if (k.has("KeyS") || k.has("ArrowDown")) forward -= 1;
  if (k.has("KeyD") || k.has("ArrowRight")) strafe += 1;
  if (k.has("KeyA") || k.has("ArrowLeft")) strafe -= 1;
  if (forward === 0 && strafe === 0) return { moveX: 0, moveZ: 0 };

  const yaw = state.orbit.yaw;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const fx = -sin;
  const fz = -cos;
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
