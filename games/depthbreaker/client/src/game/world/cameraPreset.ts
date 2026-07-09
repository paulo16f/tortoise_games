export const CAMERA_MODE = "perspective_arpg_close" as const;

export const ARPG_CAMERA = {
  yaw: Math.PI,
  pitch: 0.58,
  distance: 8.5,
  minDistance: 6.5,
  maxDistance: 12,
  fov: 48,
  minPitch: 0.32,
  maxPitch: 0.82,
  yawSpeed: 0.006,
  pitchSpeed: 0.0035,
  targetLerp: 12,
} as const;
