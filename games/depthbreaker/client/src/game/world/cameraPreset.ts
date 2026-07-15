export const CAMERA_MODE = "perspective_diablo_fixed" as const;

// Fixed steep top-down (Diablo 3/4 feel): a locked high pitch + fixed yaw, no
// free rotation. Only the wheel-zoom distance varies. minPitch === maxPitch and
// the zero rotate-speeds make the angle immutable even if a stray input slips
// through; CameraRig also pins yaw each frame.
export const ARPG_CAMERA = {
  yaw: Math.PI,
  pitch: 1.05, // ≈ 60° above horizontal — steep top-down
  distance: 14.5,
  minDistance: 10,
  maxDistance: 20,
  fov: 42,
  minPitch: 1.05,
  maxPitch: 1.05,
  yawSpeed: 0,
  pitchSpeed: 0,
  targetLerp: 12,
} as const;
