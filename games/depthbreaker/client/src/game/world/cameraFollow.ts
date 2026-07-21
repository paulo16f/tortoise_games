export interface CameraFollowInput {
  camYaw: number;
  targetYaw: number;
  delta: number;
  moving: boolean;
  orbiting: boolean;
}

const SETTLE_RATE = 5.5;
const MAX_SETTLE_STEP = 0.14;
const MAX_AUTO_YAW_SPEED = 3.4;

export function updateFollowCameraYaw(input: CameraFollowInput): number {
  if (input.orbiting || !input.moving) return input.camYaw;
  const diff = wrapAngle(input.targetYaw - input.camYaw);
  const eased = diff * (1 - Math.exp(-Math.max(0, input.delta) * SETTLE_RATE));
  const settled = input.camYaw + clamp(eased, -MAX_SETTLE_STEP, MAX_SETTLE_STEP);
  return stepAngleToward(input.camYaw, settled, MAX_AUTO_YAW_SPEED * Math.min(Math.max(input.delta, 0), 1 / 30));
}

export function wrapAngle(value: number): number {
  let d = value;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function stepAngleToward(current: number, target: number, maxStep: number): number {
  const step = Math.max(0, maxStep);
  const d = wrapAngle(target - current);
  if (Math.abs(d) <= step) return target;
  return current + Math.sign(d) * step;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
