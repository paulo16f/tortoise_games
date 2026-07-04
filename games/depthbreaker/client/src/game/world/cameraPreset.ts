export const CAMERA_MODE = "perspective_arpg_close" as const;

export const ARPG_CAMERA = {
  yaw: Math.PI,
  pitch: 0.58,
  distance: 8.5,
  minDistance: 6.5,
  maxDistance: 12,
  fov: 48,
  panLimit: 1.2,
  targetLerp: 12,
} as const;
